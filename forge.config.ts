import type { ForgeConfig, ForgeMakeResult } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { PublisherGithub } from '@electron-forge/publisher-github';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import path from 'node:path';
import fs from 'fs-extra';

// Native/external modules that Vite externalises and must be copied into the package
const nativeModules = ['better-sqlite3', '@vlcn.io/crsqlite', 'pg'];

// Recursively resolve production dependencies of a module
function collectDeps(modName: string, projectDir: string, collected: Set<string> = new Set()): Set<string> {
  if (collected.has(modName)) return collected;
  collected.add(modName);
  try {
    const pkgPath = path.join(projectDir, 'node_modules', modName, 'package.json');
    const pkg = fs.readJsonSync(pkgPath);
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      collectDeps(dep, projectDir, collected);
    }
  } catch {
    // Module not found — skip (optional peer dep, etc.)
  }
  return collected;
}

const config: ForgeConfig = {
  packagerConfig: {
    appBundleId: 'com.fidra.app',
    icon: 'resources/icon',
    asar: {
      unpack: '**/node_modules/{better-sqlite3,@vlcn.io}/**',
    },
    protocols: [
      {
        name: 'Fidra',
        schemes: ['fidra'],
      },
    ],
  },
  hooks: {
    // packageAfterCopy runs at position 3 in Forge's afterCopy chain,
    // RIGHT BEFORE electron-rebuild at position 4. This is the correct
    // place to copy native modules so they get rebuilt for Electron.
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      const projectDir = path.resolve(__dirname);
      const allDeps = new Set<string>();
      for (const mod of nativeModules) {
        collectDeps(mod, projectDir, allDeps);
      }
      for (const dep of allDeps) {
        const src = path.join(projectDir, 'node_modules', dep);
        const dest = path.join(buildPath, 'node_modules', dep);
        if (fs.existsSync(src)) {
          await fs.copy(src, dest);
        }
      }

      // Write package.json with better-sqlite3 dependency BEFORE Forge's
      // rebuild step runs (position 4). Without this, electron-rebuild
      // won't find any native modules to rebuild.
      const buildPkgPath = path.join(buildPath, 'package.json');
      const buildPkg: Record<string, unknown> = fs.existsSync(buildPkgPath)
        ? fs.readJsonSync(buildPkgPath)
        : { name: 'fidra-web', version: '0.1.0', main: '.vite/build/index.js' };
      const bsqlPkg = fs.readJsonSync(
        path.join(buildPath, 'node_modules', 'better-sqlite3', 'package.json'),
      );
      buildPkg.dependencies = {
        ...((buildPkg.dependencies as Record<string, string>) ?? {}),
        'better-sqlite3': bsqlPkg.version,
      };
      fs.writeJsonSync(buildPkgPath, buildPkg, { spaces: 2 });
    },
    // Ad-hoc code signing removed: Squirrel.Mac rejects updates when ad-hoc
    // signatures don't match between builds. Unsigned apps skip signature
    // validation entirely, allowing auto-updates to work without an Apple
    // Developer certificate. Entitlements (JIT, library validation) are only
    // enforced under hardened runtime, which unsigned apps don't use.
    postMake: async (_forgeConfig, makeResults: ForgeMakeResult[]) => {
      // 1. Rename user-facing installer artifacts to stable names
      //    so GitHub "latest" URLs work: /releases/latest/download/Fidra-macOS.dmg
      //    Auto-update files (ZIP, nupkg, RELEASES) keep original names.
      const renameMap: Record<string, (original: string, arch: string) => string | null> = {
        '.dmg': (_o, arch) => `Fidra-macOS${arch !== 'x64' ? `-${arch}` : ''}.dmg`,
        'Setup.exe': () => 'Fidra-Windows-Setup.exe',
      };

      for (const result of makeResults) {
        result.artifacts = result.artifacts.map((artifactPath) => {
          const basename = path.basename(artifactPath);
          for (const [suffix, nameFn] of Object.entries(renameMap)) {
            if (basename.endsWith(suffix)) {
              const newName = nameFn(basename, result.arch);
              if (newName && newName !== basename) {
                const newPath = path.join(path.dirname(artifactPath), newName);
                fs.renameSync(artifactPath, newPath);
                console.log(`[RENAME] ${basename} → ${newName}`);
                return newPath;
              }
            }
          }
          return artifactPath;
        });
      }

      // 2. Remove intermediate packaged app directories so Spotlight
      //    doesn't index them (the DMG/ZIP in out/make/ is the real output)
      const outBase = path.resolve(__dirname, 'out');
      if (fs.existsSync(outBase)) {
        for (const entry of fs.readdirSync(outBase)) {
          const full = path.join(outBase, entry);
          if (entry !== 'make' && fs.statSync(full).isDirectory()) {
            fs.removeSync(full);
            console.log('[CLEANUP] Removed intermediate build:', entry);
          }
        }
      }

      return makeResults;
    },
  },
  rebuildConfig: {
    force: true,
  },
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerDMG({}),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  publishers: [
    new PublisherGithub({
      repository: {
        owner: 'LordPam',
        name: 'fidra-electron',
      },
      prerelease: false,
      draft: true,
    }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
