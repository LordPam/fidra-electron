import { Button } from '@/components/ui/button';
import { ZoomIn, ZoomOut } from 'lucide-react';

interface ZoomControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  min?: number;
  max?: number;
}

export function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
  min = 0.5,
  max = 1.5,
}: ZoomControlsProps) {
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="sm" onClick={onZoomOut} disabled={zoom <= min} title="Zoom out (Cmd+Shift+-)">
        <ZoomOut className="h-4 w-4" />
      </Button>
      <button
        type="button"
        onClick={onReset}
        className="text-[11px] font-mono text-muted-foreground hover:text-foreground min-w-[3ch] text-center"
        title="Reset zoom (Cmd+Shift+0)"
      >
        {Math.round(zoom * 100)}%
      </button>
      <Button variant="ghost" size="sm" onClick={onZoomIn} disabled={zoom >= max} title="Zoom in (Cmd+Shift+=)">
        <ZoomIn className="h-4 w-4" />
      </Button>
    </div>
  );
}
