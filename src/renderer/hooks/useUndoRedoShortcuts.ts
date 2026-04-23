import { useEffect } from 'react';
import { useUndoStore } from '@/stores/undo-store';

/**
 * Registers Cmd+Z / Cmd+Shift+Z keyboard shortcuts for undo/redo.
 * Handlers fire regardless of input focus (undo should always work).
 */
export function useUndoRedoShortcuts() {
  const undo = useUndoStore((s) => s.undo);
  const redo = useUndoStore((s) => s.redo);
  const canUndo = useUndoStore((s) => s.canUndo);
  const canRedo = useUndoStore((s) => s.canRedo);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod || e.key !== 'z') return;

      e.preventDefault();
      if (e.shiftKey) {
        if (canRedo()) redo();
      } else {
        if (canUndo()) undo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, canUndo, canRedo]);
}
