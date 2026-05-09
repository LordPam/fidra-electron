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
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import fs from 'fs-extra';

// Native/external modules that Vite externalises and must be copied into the package
const nativeModules = ['better-sqlite3', '@vlcn.io/crsqlite', 'pg', 'electron-updater'];

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
    extraResource: ['app-update.yml'],
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
    postPackage: async (_forgeConfig, options) => {
      if (process.platform !== 'darwin') return;

      // Find the .app bundle in the output directory
      const outDir = options.outputPaths[0];
      const appEntry = fs.readdirSync(outDir).find((f: string) => f.endsWith('.app'));
      if (!appEntry) { console.warn('[SIGN] No .app found in', outDir); return; }
      const appPath = path.join(outDir, appEntry);
      const projectDir = path.resolve(__dirname);
      const entitlements = path.join(projectDir, 'entitlements.mac.plist');
      const inheritEntitlements = path.join(projectDir, 'entitlements.mac.inherit.plist');

      console.log('[SIGN] Ad-hoc signing', appPath);

      // iCloud Drive continuously adds resource forks that codesign rejects.
      // Copy to /tmp (outside iCloud), sign there, copy back.
      const tmpApp = path.join('/tmp', `fidra-sign-${Date.now()}`, appEntry);
      fs.mkdirSync(path.dirname(tmpApp), { recursive: true });
      execSync(`ditto "${appPath}" "${tmpApp}"`, { stdio: 'pipe' });
      execSync(`xattr -cr "${tmpApp}"`, { stdio: 'pipe' });

      // Sign all nested binaries first (inside-out signing is required)
      const findBinaries = (dir: string): string[] => {
        const results: string[] = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name.endsWith('.framework') || entry.name.endsWith('.app')) {
              results.push(full);
            } else {
              results.push(...findBinaries(full));
            }
          } else if (entry.isFile()) {
            if (entry.name.endsWith('.dylib') || entry.name.endsWith('.node') || entry.name.endsWith('.so')) {
              results.push(full);
            }
          }
        }
        return results;
      };

      const nestedBinaries = findBinaries(tmpApp);
      for (const bin of nestedBinaries) {
        const ent = bin.includes('Helper') ? inheritEntitlements : entitlements;
        try {
          execSync(`codesign --force --sign - --entitlements "${ent}" "${bin}"`, { stdio: 'pipe' });
        } catch {
          // Some files may not need signing
        }
      }

      // Sign the main app bundle last
      execSync(
        `codesign --force --sign - --entitlements "${entitlements}" "${tmpApp}"`,
        { stdio: 'inherit' },
      );

      // Verify
      const result = execSync(`codesign -dv --entitlements - "${tmpApp}" 2>&1`, { encoding: 'utf-8' });
      console.log('[SIGN] Verification:', result.substring(0, 300));

      // Copy signed app back
      fs.removeSync(appPath);
      execSync(`ditto "${tmpApp}" "${appPath}"`, { stdio: 'pipe' });
      fs.removeSync(path.dirname(tmpApp));
    },
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

      // 2. Generate electron-updater metadata files (latest-mac.yml / latest.yml)
      //    electron-updater checks these to discover new versions and verify downloads.
      const projectPkg = fs.readJsonSync(path.resolve(__dirname, 'package.json'));
      const appVersion: string = projectPkg.version;
      const releaseDate = new Date().toISOString();

      for (const result of makeResults) {
        // macOS: generate latest-mac.yml from the ZIP artifact
        if (result.platform === 'darwin') {
          const zipPath = result.artifacts.find((a) => a.endsWith('.zip'));
          if (zipPath && fs.existsSync(zipPath)) {
            const zipName = path.basename(zipPath);
            const zipBuf = fs.readFileSync(zipPath);
            const sha512 = crypto.createHash('sha512').update(zipBuf).digest('base64');
            const size = zipBuf.length;
            const yml = [
              `version: ${appVersion}`,
              `files:`,
              `  - url: ${zipName}`,
              `    sha512: ${sha512}`,
              `    size: ${size}`,
              `path: ${zipName}`,
              `sha512: ${sha512}`,
              `releaseDate: '${releaseDate}'`,
              '',
            ].join('\n');
            const ymlPath = path.join(path.dirname(zipPath), 'latest-mac.yml');
            fs.writeFileSync(ymlPath, yml);
            result.artifacts.push(ymlPath);
            console.log(`[UPDATE-YML] Generated latest-mac.yml for ${zipName}`);
          }
        }

        // Windows: generate latest.yml from the Setup.exe artifact
        if (result.platform === 'win32') {
          const exePath = result.artifacts.find((a) => a.endsWith('.exe'));
          if (exePath && fs.existsSync(exePath)) {
            const exeName = path.basename(exePath);
            const exeBuf = fs.readFileSync(exePath);
            const sha512 = crypto.createHash('sha512').update(exeBuf).digest('base64');
            const size = exeBuf.length;
            const yml = [
              `version: ${appVersion}`,
              `files:`,
              `  - url: ${exeName}`,
              `    sha512: ${sha512}`,
              `    size: ${size}`,
              `path: ${exeName}`,
              `sha512: ${sha512}`,
              `releaseDate: '${releaseDate}'`,
              '',
            ].join('\n');
            const ymlPath = path.join(path.dirname(exePath), 'latest.yml');
            fs.writeFileSync(ymlPath, yml);
            result.artifacts.push(ymlPath);
            console.log(`[UPDATE-YML] Generated latest.yml for ${exeName}`);
          }
        }
      }

      // 3. Remove intermediate packaged app directories so Spotlight
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
