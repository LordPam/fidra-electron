import { useState, useCallback, useRef, useEffect } from 'react';
import { Upload, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DropZoneProps {
  onFilesDropped: (files: { path: string; name: string }[]) => void;
  /** When true, shows a pulse animation (e.g. files being processed) */
  isProcessing?: boolean;
  className?: string;
}

export function DropZone({ onFilesDropped, isProcessing, className }: DropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [windowDragActive, setWindowDragActive] = useState(false);
  const dragCounter = useRef(0);

  // Listen for drag events on the window to pulse when files are dragged anywhere
  useEffect(() => {
    let windowDragCounter = 0;

    const onDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        windowDragCounter++;
        if (windowDragCounter === 1) setWindowDragActive(true);
      }
    };
    const onDragLeave = () => {
      windowDragCounter--;
      if (windowDragCounter <= 0) {
        windowDragCounter = 0;
        setWindowDragActive(false);
      }
    };
    const onDrop = () => {
      windowDragCounter = 0;
      setWindowDragActive(false);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      dragCounter.current = 0;

      const files: { path: string; name: string }[] = [];
      const dtFiles = e.dataTransfer.files;
      for (let i = 0; i < dtFiles.length; i++) {
        const f = dtFiles[i];
        const filePath = window.api.getPathForFile(f);
        if (filePath) {
          files.push({ path: filePath, name: f.name });
        }
      }
      if (files.length > 0) {
        onFilesDropped(files);
        // Show success flash
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 1200);
      }
    },
    [onFilesDropped],
  );

  const handleClick = useCallback(async () => {
    const result = await window.api.showOpenDialog({
      title: 'Attach Files',
      properties: ['openFile', 'multiSelections'],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      const files = result.filePaths.map((p) => ({
        path: p,
        name: p.split('/').pop() ?? p,
      }));
      onFilesDropped(files);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 1200);
    }
  }, [onFilesDropped]);

  const isPulsing = windowDragActive || isProcessing;

  return (
    <div
      className={cn(
        'relative flex items-center justify-center gap-2 rounded-lg border-2 border-dashed px-3 py-2 cursor-pointer transition-all text-xs text-muted-foreground',
        isDragOver
          ? 'border-fidra-teal bg-fidra-teal/10 text-fidra-teal scale-[1.02]'
          : showSuccess
            ? 'border-fidra-positive bg-fidra-positive/10 text-fidra-positive'
            : isPulsing
              ? 'border-fidra-teal/60 text-fidra-teal animate-pulse'
              : 'border-border-subtle hover:border-fidra-teal/40 hover:text-foreground',
        className,
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={handleClick}
    >
      {showSuccess ? (
        <>
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>Added!</span>
        </>
      ) : (
        <>
          <Upload className="h-3.5 w-3.5 shrink-0" />
          <span>{isDragOver ? 'Drop to attach' : 'Drop files here or click to browse'}</span>
        </>
      )}
    </div>
  );
}
