import { useUndoStore } from '@/stores/undo-store';
import { Button } from '@/components/ui/button';
import { Undo2, Redo2 } from 'lucide-react';

interface UndoRedoButtonsProps {
  showDescriptions?: boolean;
  withSeparators?: boolean;
}

export function UndoRedoButtons({ showDescriptions = true, withSeparators = true }: UndoRedoButtonsProps) {
  const undo = useUndoStore((s) => s.undo);
  const redo = useUndoStore((s) => s.redo);
  const canUndo = useUndoStore((s) => s.canUndo);
  const canRedo = useUndoStore((s) => s.canRedo);
  const undoDescription = useUndoStore((s) => s.undoDescription);
  const redoDescription = useUndoStore((s) => s.redoDescription);

  const undoTitle = showDescriptions && undoDescription()
    ? `Undo: ${undoDescription()}`
    : 'Undo';
  const redoTitle = showDescriptions && redoDescription()
    ? `Redo: ${redoDescription()}`
    : 'Redo';

  return (
    <>
      {withSeparators && <div className="w-px h-5 bg-border-subtle mx-1" />}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => undo()}
        disabled={!canUndo()}
        title={undoTitle}
      >
        <Undo2 className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => redo()}
        disabled={!canRedo()}
        title={redoTitle}
      >
        <Redo2 className="h-4 w-4" />
      </Button>
      {withSeparators && <div className="w-px h-5 bg-border-subtle mx-1" />}
    </>
  );
}
