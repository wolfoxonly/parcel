// @flow
import type {
  FilePath,
  PackageJSON,
  Target,
  EnvironmentContext,
  Engines
} from '@parcel/types';
import {loadConfig} from '@parcel/utils/src/config';
import Environment from './Environment';
import path from 'path';
import browserslist from 'browserslist';

const DEFAULT_ENGINES = {
  browsers: ['> 0.25%'],
  node: '8'
};

const DEFAULT_DIST_DIR = 'dist';

export default class TargetResolver {
  async resolve(rootDir: FilePath): Promise<Array<Target>> {
    let conf = await loadConfig(path.join(rootDir, 'index'), ['package.json']);

    let pkg: PackageJSON = conf ? conf.config : {};
    let pkgTargets = pkg.targets || {};
    let pkgEngines = Object.assign({}, pkg.engines);
    if (!pkgEngines.browsers) {
      pkgEngines.browsers = browserslist.loadConfig({path: rootDir});
    }

    let targets = [];
    let node = pkgEngines.node;
    let browsers = pkgEngines.browsers;

    // If there is a separate `browser` target, or an `engines.node` field but no browser targets, then
    // the `main` and `module` targets refer to node, otherwise browser.
    let mainContext =
      pkg.browser || pkgTargets.browser || (node && !browsers)
        ? 'node'
        : 'browser';

    if (typeof pkg.main === 'string' || pkgTargets.main) {
      let distDir;
      let distEntry;

      let main = pkg.main;
      if (typeof main === 'string') {
        distDir = path.dirname(main);
        distEntry = path.basename(main);
      } else {
        distDir = path.join(DEFAULT_DIST_DIR, 'main');
      }

      targets.push({
        name: 'main',
        distDir,
        distEntry,
        env: this.getEnvironment(pkgEngines, mainContext).merge(pkgTargets.main)
      });
    }

    if (typeof pkg.module === 'string' || pkgTargets.module) {
      let distDir;
      let distEntry;

      let mod = pkg.module;
      if (typeof mod === 'string') {
        distDir = path.dirname(mod);
        distEntry = path.basename(mod);
      } else {
        distDir = path.join(DEFAULT_DIST_DIR, 'module');
      }

      targets.push({
        name: 'module',
        distDir,
        distEntry,
        env: this.getEnvironment(pkgEngines, mainContext).merge(
          pkgTargets.module
        )
      });
    }

    // The `browser` field can be a file path or an alias map.
    let browser = pkg.browser;
    if (browser && typeof browser === 'object') {
      browser = browser[pkg.name];
    }

    if (typeof browser === 'string' || pkgTargets.browser) {
      let distDir;
      let distEntry;
      if (typeof browser === 'string') {
        distDir = path.dirname(browser);
        distEntry = path.basename(browser);
      } else {
        distDir = path.join(DEFAULT_DIST_DIR, 'browser');
      }

      targets.push({
        name: 'browser',
        distEntry,
        distDir,
        env: this.getEnvironment(pkgEngines, 'browser').merge(
          pkgTargets.browser
        )
      });
    }

    // Custom targets
    for (let name in pkgTargets) {
      if (name === 'main' || name === 'module' || name === 'browser') {
        continue;
      }

      let distPath = pkg[name];
      let distDir;
      let distEntry;
      if (distPath == null) {
        distDir = path.join(DEFAULT_DIST_DIR, name);
      } else {
        distDir = path.dirname(distPath);
        distEntry = path.basename(distPath);
      }

      let env = pkgTargets[name];
      if (env) {
        let context =
          env.context || (env.engines && env.engines.node ? 'node' : 'browser');
        targets.push({
          name,
          distDir,
          distEntry,
          env: this.getEnvironment(pkgEngines, context).merge(env)
        });
      }
    }

    // If no explicit targets were defined, add a default.
    if (targets.length === 0) {
      let context = browsers || !node ? 'browser' : 'node';
      targets.push({
        name: 'default',
        distDir: 'dist',
        env: this.getEnvironment(pkgEngines, context)
      });
    }

    return targets;
  }

  getEnvironment(
    pkgEngines: Engines,
    context: EnvironmentContext
  ): Environment {
    let engines = {};

    if (context === 'node') {
      engines.node = pkgEngines.node || DEFAULT_ENGINES.node;
    } else {
      engines.browsers = pkgEngines.browsers || DEFAULT_ENGINES.browsers;
    }

    return new Environment({
      context,
      engines,
      includeNodeModules: context === 'browser'
    });
  }
}
