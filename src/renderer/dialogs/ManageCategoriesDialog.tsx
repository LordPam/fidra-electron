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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown } from 'lucide-react';

interface ManageCategoriesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  incomeCategories: string[];
  expenseCategories: string[];
  onSave: (type: 'income' | 'expense', names: string[]) => Promise<void>;
}

function CategoryList({
  categories: initial,
  onSave,
}: {
  categories: string[];
  onSave: (names: string[]) => Promise<void>;
}) {
  const [items, setItems] = useState<string[]>(initial);
  const [newName, setNewName] = useState('');
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setItems(initial);
    setDirty(false);
  }, [initial]);

  const validate = (name: string, excludeIdx?: number): string | null => {
    const trimmed = name.trim();
    if (!trimmed) return 'Name is required';
    if (items.some((item, idx) => item.toLowerCase() === trimmed.toLowerCase() && idx !== excludeIdx)) {
      return 'Category already exists';
    }
    return null;
  };

  const handleAdd = () => {
    const err = validate(newName);
    if (err) { setError(err); return; }
    setItems([...items, newName.trim()]);
    setNewName('');
    setError('');
    setDirty(true);
  };

  const handleRename = (idx: number) => {
    const err = validate(editValue, idx);
    if (err) { setError(err); return; }
    const next = [...items];
    next[idx] = editValue.trim();
    setItems(next);
    setEditingIdx(null);
    setEditValue('');
    setError('');
    setDirty(true);
  };

  const handleDelete = (idx: number) => {
    setItems(items.filter((_, i) => i !== idx));
    setDirty(true);
  };

  const handleMove = (idx: number, direction: 'up' | 'down') => {
    const next = [...items];
    const target = direction === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setItems(next);
    setDirty(true);
  };

  const handleSave = useCallback(async () => {
    await onSave(items);
    setDirty(false);
  }, [items, onSave]);

  // Cmd+S to save
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dirty, handleSave]);

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Input
          value={newName}
          onChange={(e) => { setNewName(e.target.value); setError(''); }}
          placeholder="New category"
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <Button size="sm" onClick={handleAdd}>
          <Plus className="h-4 w-4 mr-1" /> Add
        </Button>
      </div>

      <div className="flex flex-col gap-0.5 max-h-64 overflow-y-auto">
        {items.map((item, idx) => (
          <div key={`${item}-${idx}`} className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted">
            {editingIdx === idx ? (
              <>
                <Input
                  value={editValue}
                  onChange={(e) => { setEditValue(e.target.value); setError(''); }}
                  className="h-7 text-sm flex-1"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRename(idx);
                    if (e.key === 'Escape') setEditingIdx(null);
                  }}
                />
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => handleRename(idx)}>
                  Save
                </Button>
              </>
            ) : (
              <>
                <span className="flex-1 text-sm">{item}</span>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => handleMove(idx, 'up')} disabled={idx === 0}>
                  <ChevronUp className="h-3 w-3" />
                </Button>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => handleMove(idx, 'down')} disabled={idx === items.length - 1}>
                  <ChevronDown className="h-3 w-3" />
                </Button>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { setEditingIdx(idx); setEditValue(item); }}>
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => handleDelete(idx)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </>
            )}
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">No categories yet</p>
        )}
      </div>

      {dirty && (
        <Button size="sm" onClick={handleSave} className="self-end">
          Save Changes
        </Button>
      )}
    </div>
  );
}

export function ManageCategoriesDialog({
  open,
  onOpenChange,
  incomeCategories,
  expenseCategories,
  onSave,
}: ManageCategoriesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manage Categories</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="expense">
          <TabsList className="w-full">
            <TabsTrigger value="expense" className="flex-1">Expense</TabsTrigger>
            <TabsTrigger value="income" className="flex-1">Income</TabsTrigger>
          </TabsList>
          <TabsContent value="expense">
            <CategoryList
              categories={expenseCategories}
              onSave={(names) => onSave('expense', names)}
            />
          </TabsContent>
          <TabsContent value="income">
            <CategoryList
              categories={incomeCategories}
              onSave={(names) => onSave('income', names)}
            />
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
