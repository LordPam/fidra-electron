import { AlertTriangle } from 'lucide-react';
import type { PlannedTemplateRow } from '../../shared/ipc-types';
import { formatDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export type PlannedGroupAction = 'duplicate' | 'delete';

interface PlannedGroupWarningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: PlannedGroupAction;
  template: PlannedTemplateRow | null;
  instanceDate: string | null;
  onConfirm: () => void | Promise<void>;
}

export function PlannedGroupWarningDialog({
  open,
  onOpenChange,
  action,
  template,
  instanceDate,
  onConfirm,
}: PlannedGroupWarningDialogProps) {
  if (!template) return null;
  const verb = action === 'duplicate' ? 'Duplicate' : 'Delete';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="planned-group-warning">
        <DialogHeader>
          <DialogTitle>{verb} the whole planned group?</DialogTitle>
        </DialogHeader>
        <div className="flex gap-3 rounded-md border border-fidra-warning/40 bg-fidra-warning/10 p-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-fidra-warning" />
          <p className="text-sm text-foreground">
            You selected the occurrence on {instanceDate ? formatDate(instanceDate) : 'this date'}. Planned occurrences are linked, so this will {action} the entire “{template.description}” group and all its linked occurrences.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant={action === 'delete' ? 'destructive' : 'default'}
            onClick={async () => {
              await onConfirm();
              onOpenChange(false);
            }}
          >
            {verb} Group
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
