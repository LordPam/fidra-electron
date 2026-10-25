let cached: boolean | null = null;

/**
 * True when running in the macOS Electron window, which is frameless
 * (`titleBarStyle: 'hiddenInset'`). Views that touch the top edge of the
 * window need to leave room for the traffic lights there.
 *
 * Resolved lazily: `window.api` is installed by the preload before renderer
 * scripts run in Electron, but the gh-pages demo assigns it from its own entry
 * module, which is after this module's top level has already evaluated.
 */
export function isMacFrameless(): boolean {
  if (cached === null) {
    cached = typeof window !== 'undefined' && window.api?.platform === 'darwin';
  }
  return cached;
}
