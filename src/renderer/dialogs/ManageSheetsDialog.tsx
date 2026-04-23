import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Pencil, Trash2, Plus, ChevronUp, ChevronDown } from 'lucide-react';
import type { SheetRow } from '../../shared/ipc-types';

interface ManageSheetsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sheets: SheetRow[];
  onAdd: (id: string, name: string) => Promise<void>;
  onRename: (oldName: string, newName: string) => Promise<void>;
  onDelete: (id: string, name: string, mergeTarget?: string) => Promise<void>;
  onReorder: (orderedIds: string[]) => Promise<void>;
}

export function ManageSheetsDialog({
  open,
  onOpenChange,
  sheets,
  onAdd,
  onRename,
  onDelete,
  onReorder,
}: ManageSheetsDialogProps) {
  const [items, setItems] = useState<SheetRow[]>(sheets);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState('');
  const [deleteMode, setDeleteMode] = useState<'merge' | 'delete'>('merge');
  const [error, setError] = useState('');
  const [orderDirty, setOrderDirty] = useState(false);

  // Sync local items when sheets prop changes
  useEffect(() => {
    setItems(sheets);
    setOrderDirty(false);
  }, [sheets]);

  const validateName = (name: string, excludeId?: string): string | null => {
    const trimmed = name.trim();
    if (!trimmed) return 'Name is required';
    if (trimmed.toLowerCase() === 'all sheets') return 'Cannot use "All Sheets"';
    if (items.some((s) => s.name.toLowerCase() === trimmed.toLowerCase() && s.id !== excludeId)) {
      return 'Name already exists';
    }
    return null;
  };

  const handleAdd = async () => {
    const err = validateName(newName);
    if (err) { setError(err); return; }
    await onAdd(crypto.randomUUID(), newName.trim());
    setNewName('');
    setError('');
  };

  const handleRename = async (id: string, oldName: string) => {
    const err = validateName(editValue, id);
    if (err) { setError(err); return; }
    await onRename(oldName, editValue.trim());
    setEditingId(null);
    setEditValue('');
    setError('');
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    const sheet = items.find((s) => s.id === deletingId);
    if (!sheet) return;

    if (items.length <= 1) {
      setError('Cannot delete the last sheet');
      return;
    }

    if (deleteMode === 'merge' && mergeTarget) {
      await onDelete(sheet.id, sheet.name, mergeTarget);
    } else {
      await onDelete(sheet.id, sheet.name);
    }
    setDeletingId(null);
    setMergeTarget('');
    setError('');
  };

  const handleMove = (idx: number, direction: 'up' | 'down') => {
    const next = [...items];
    const target = direction === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setItems(next);
    setOrderDirty(true);
  };

  const handleSaveOrder = useCallback(async () => {
    await onReorder(items.map((s) => s.id));
    setOrderDirty(false);
  }, [items, onReorder]);

  // Cmd+S to save order
  useEffect(() => {
    if (!open || !orderDirty) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSaveOrder();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, orderDirty, handleSaveOrder]);

  const deletingSheet = items.find((s) => s.id === deletingId);
  const mergeOptions = items.filter((s) => s.id !== deletingId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manage Sheets</DialogTitle>
        </DialogHeader>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {/* Add new sheet */}
        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={(e) => { setNewName(e.target.value); setError(''); }}
            placeholder="New sheet name"
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <Button size="sm" onClick={handleAdd}>
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
        </div>

        {/* Sheet list */}
        <div className="flex flex-col gap-0.5 max-h-64 overflow-y-auto">
          {items.map((sheet, idx) => (
            <div key={sheet.id} className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted">
              {editingId === sheet.id ? (
                <>
                  <Input
                    value={editValue}
                    onChange={(e) => { setEditValue(e.target.value); setError(''); }}
                    className="h-7 text-sm flex-1"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename(sheet.id, sheet.name);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => handleRename(sheet.id, sheet.name)}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm">{sheet.name}</span>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => handleMove(idx, 'up')} disabled={idx === 0}>
                    <ChevronUp className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => handleMove(idx, 'down')} disabled={idx === items.length - 1}>
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0"
                    onClick={() => { setEditingId(sheet.id); setEditValue(sheet.name); setError(''); }}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 text-destructive"
                    onClick={() => { setDeletingId(sheet.id); setError(''); }}
                    disabled={items.length <= 1}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Delete confirmation */}
        {deletingSheet && (
          <div className="rounded-md border border-destructive/50 p-3 space-y-2">
            <p className="text-sm font-medium">Delete &ldquo;{deletingSheet.name}&rdquo;?</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={deleteMode === 'merge' ? 'default' : 'outline'}
                onClick={() => setDeleteMode('merge')}
              >
                Merge
              </Button>
              <Button
                size="sm"
                variant={deleteMode === 'delete' ? 'destructive' : 'outline'}
                onClick={() => setDeleteMode('delete')}
              >
                Delete all
              </Button>
            </div>
            {deleteMode === 'merge' && mergeOptions.length > 0 && (
              <Select value={mergeTarget} onValueChange={setMergeTarget}>
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="Move items to..." />
                </SelectTrigger>
                <SelectContent>
                  {mergeOptions.map((s) => (
                    <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" onClick={handleDelete}
                disabled={deleteMode === 'merge' && !mergeTarget}
              >
                Confirm
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDeletingId(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          {orderDirty && (
            <Button onClick={handleSaveOrder}>
              Save Order
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
