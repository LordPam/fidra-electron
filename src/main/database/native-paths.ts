import { extensionPath as rawExtensionPath } from '@vlcn.io/crsqlite';

/**
 * In a packaged Electron app, native modules are unpacked to app.asar.unpacked/
 * but @vlcn.io/crsqlite resolves its path relative to __dirname which points
 * inside app.asar. We fix that by replacing app.asar with app.asar.unpacked.
 */
function resolveUnpackedPath(p: string): string {
  return p.replace('app.asar', 'app.asar.unpacked');
}

export const crsqliteExtensionPath = resolveUnpackedPath(rawExtensionPath);
