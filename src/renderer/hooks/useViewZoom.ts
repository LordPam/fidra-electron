import { useCallback } from 'react';
import { useUiStore, type ZoomKey } from '@/stores/ui-store';
import { useZoomShortcuts } from './useZoomShortcuts';

/**
 * Combines zoom state + keyboard shortcuts for a view's table zoom.
 *
 * Returns the current zoom level and stable callbacks for ZoomControls.
 * Registers Cmd+Shift+=/−/0 shortcuts automatically.
 */
export function useViewZoom(key: ZoomKey) {
  const zoom = useUiStore((s) => s[key]);
  const adjustZoom = useUiStore((s) => s.adjustZoom);

  const zoomIn = useCallback(() => adjustZoom(key, 'in'), [adjustZoom, key]);
  const zoomOut = useCallback(() => adjustZoom(key, 'out'), [adjustZoom, key]);
  const resetZoom = useCallback(() => adjustZoom(key, 'reset'), [adjustZoom, key]);

  useZoomShortcuts(zoomIn, zoomOut, resetZoom);

  return { zoom, zoomIn, zoomOut, resetZoom };
}
