import { useEffect } from 'react';

/**
 * Registers Cmd+Shift+= / Cmd+Shift+- / Cmd+Shift+0 keyboard shortcuts
 * for table zoom in / out / reset.
 */
export function useZoomShortcuts(zoomIn: () => void, zoomOut: () => void, reset: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod || !e.shiftKey) return;

      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomIn();
      } else if (e.key === '_' || e.key === '-') {
        e.preventDefault();
        zoomOut();
      } else if (e.key === '0') {
        e.preventDefault();
        reset();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [zoomIn, zoomOut, reset]);
}
