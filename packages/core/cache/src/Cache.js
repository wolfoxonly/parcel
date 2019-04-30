// @flow

import type {Readable} from 'stream';

import type {
  FilePath,
  ParcelOptions,
  JSONObject,
  CacheEntry,
  Environment
} from '@parcel/types';

import * as fs from '@parcel/fs';
import {createReadStream, createWriteStream} from 'fs';
import invariant from 'assert';
import path from 'path';
import {md5FromString} from '@parcel/utils/src/md5';
import objectHash from '@parcel/utils/src/objectHash';
import logger from '@parcel/logger';
import {serialize, deserialize} from '@parcel/utils/src/serializer';
import pkg from '../package.json';

// These keys can affect the output, so if they differ, the cache should not match
// const OPTION_KEYS = ['publicURL', 'minify', 'hmr', 'target', 'scopeHoist'];
const OPTION_KEYS = [];

// Default cache directory name
const DEFAULT_CACHE_DIR = '.parcel-cache';

// Cache for whether a cache dir exists
const existsCache = new Set();

export class Cache {
  dir: FilePath;
  invalidated: Set<FilePath>;
  optionsHash: string;

  init(options: ParcelOptions) {
    this.dir = path.resolve(options.cacheDir || DEFAULT_CACHE_DIR);
    this.invalidated = new Set();
    this.optionsHash = objectHash(
      OPTION_KEYS.reduce((p: JSONObject, k) => ((p[k] = options[k]), p), {
        version: pkg.version
      })
    );
  }

  async createCacheDir(dir: FilePath = DEFAULT_CACHE_DIR): Promise<void> {
    dir = path.resolve(dir);
    if (existsCache.has(dir)) {
      return;
    }

    // Create sub-directories for every possible hex value
    // This speeds up large caches on many file systems since there are fewer files in a single directory.
    for (let i = 0; i < 256; i++) {
      await fs.mkdirp(path.join(dir, ('00' + i.toString(16)).slice(-2)));
    }

    existsCache.add(dir);
  }

  getCacheId(appendedData: string, env: Environment): string {
    return md5FromString(this.optionsHash + appendedData + JSON.stringify(env));
  }

  getCachePath(cacheId: string, extension: string = '.json'): FilePath {
    return path.join(
      this.dir,
      cacheId.slice(0, 2),
      cacheId.slice(2) + extension
    );
  }

  async writeBlob(
    type: string,
    cacheId: string,
    data: any
  ): Promise<CacheReference> {
    let blobPath = this.getCachePath(cacheId, '.' + type);
    if (typeof data === 'object') {
      if (Buffer.isBuffer(data)) {
        blobPath += '.bin';
      } else {
        data = serialize(data);
        if (type !== 'json') {
          blobPath += '.json';
        }
      }
    }

    await fs.writeFile(blobPath, data);
    return new CacheReference(path.relative(this.dir, blobPath));
  }

  async write(cacheEntry: CacheEntry): Promise<void> {
    try {
      let cacheId = this.getCacheId(cacheEntry.filePath, cacheEntry.env);
      await Promise.all([
        ...cacheEntry.assets.map(asset => asset.writeBlobs()),
        ...(cacheEntry.initialAssets || []).map(asset => asset.writeBlobs())
      ]);
      await this.writeBlob('json', cacheId, cacheEntry);
      this.invalidated.delete(cacheEntry.filePath);
    } catch (err) {
      logger.error(`Error writing to cache: ${err.message}`);
    }
  }

  async readBlob(blobKey: FilePath): Promise<any> {
    let extension = path.extname(blobKey);
    let data = await fs.readFile(path.resolve(this.dir, blobKey), {
      encoding: extension === '.bin' ? undefined : 'utf8'
    });

    if (extension === '.json') {
      invariant(typeof data === 'string');
      return deserialize(data);
    }

    return data;
  }

  async read(filePath: FilePath, env: Environment): Promise<CacheEntry | null> {
    if (this.invalidated.has(filePath)) {
      return null;
    }

    let cacheId = this.getCacheId(filePath, env);
    try {
      return await this.readBlob(this.getCachePath(cacheId));
    } catch (err) {
      return null;
    }
  }

  invalidate(filePath: FilePath) {
    this.invalidated.add(filePath);
  }

  async delete(filePath: FilePath, env: Environment): Promise<void> {
    try {
      let cacheId = this.getCacheId(filePath, env);
      // TODO: delete blobs
      await fs.unlink(this.getCachePath(cacheId));
      this.invalidated.delete(filePath);
    } catch (err) {
      // Fail silently
    }
  }

  getStream(key: string): Readable {
    return createReadStream(this.getCachePath(key, '.blob'));
  }

  async setStream(key: string, stream: Readable): Promise<string> {
    return new Promise((resolve, reject) => {
      stream
        .pipe(createWriteStream(this.getCachePath(key, '.blob')))
        .on('error', reject)
        .on('finish', () => resolve(key));
    });
  }

  async get(key: string) {
    try {
      // let extension = path.extname(key);
      // TODO: support more extensions
      let data = await fs.readFile(this.getCachePath(key), {encoding: 'utf8'});

      // if (extension === '.json') {
      invariant(typeof data === 'string');
      return deserialize(data);
      //}

      //return data;
    } catch (err) {
      if (err.code === 'ENOENT') {
        return null;
      } else {
        throw err;
      }
    }
  }

  async set(key: string, value: any) {
    try {
      // TODO: support more than just JSON
      let blobPath = this.getCachePath(key);
      let data = serialize(value);

      await fs.writeFile(blobPath, data);
      return key;
    } catch (err) {
      logger.error(`Error writing to cache: ${err.message}`);
    }
  }
}

export class CacheReference {
  filePath: FilePath;
  constructor(filePath: FilePath) {
    this.filePath = filePath;
  }

  static deserialize(value: {filePath: FilePath}): Promise<CacheReference> {
    return new CacheReference(value.filePath);
  }
}

export default new Cache();
