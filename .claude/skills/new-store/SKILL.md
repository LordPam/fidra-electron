---
name: new-store
description: Create a Zustand store slice with IPC integration for a domain entity
user-invocable: true
allowed-tools: Read, Grep, Glob, Write, Edit
argument-hint: <storeName>
---

# Create New Zustand Store

Scaffold a Zustand store called `$ARGUMENTS`.

## Steps

### 1. Create the store file

Create `src/renderer/stores/$ARGUMENTS.ts`:

```tsx
import { create } from 'zustand'

interface $ARGUMENTSState {
  // Data
  items: Item[]
  isLoading: boolean
  error: string | null

  // Actions
  load: () => Promise<void>
  add: (item: NewItem) => Promise<void>
  update: (id: string, changes: Partial<Item>) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const use$ARGUMENTS = create<$ARGUMENTSState>((set, get) => ({
  // Initial state
  items: [],
  isLoading: false,
  error: null,

  // Actions call IPC to main process, then update local state
  load: async () => {
    set({ isLoading: true, error: null })
    try {
      const items = await window.api.CHANNEL_NAME.getAll()
      set({ items, isLoading: false })
    } catch (e) {
      set({ error: (e as Error).message, isLoading: false })
    }
  },

  add: async (item) => {
    const created = await window.api.CHANNEL_NAME.create(item)
    set((state) => ({ items: [...state.items, created] }))
  },

  update: async (id, changes) => {
    const updated = await window.api.CHANNEL_NAME.update(id, changes)
    set((state) => ({
      items: state.items.map((i) => (i.id === id ? updated : i)),
    }))
  },

  remove: async (id) => {
    await window.api.CHANNEL_NAME.delete(id)
    set((state) => ({
      items: state.items.filter((i) => i.id !== id),
    }))
  },
}))
```

### 2. Store conventions

- **One store per domain entity** (transactions, sheets, categories, planned templates)
- **UI-only state** goes in a separate `uiStore` (selected IDs, search query, active sheet filter)
- **Actions are async** — they call IPC, then update local state optimistically or after response
- **No derived state in the store** — compute derived values in components or custom hooks using `useMemo`
- **Selectors**: Encourage consumers to select slices to minimise re-renders:
  ```tsx
  const items = useTransactionStore((s) => s.items)
  const isLoading = useTransactionStore((s) => s.isLoading)
  ```

### 3. Mapping from Python Observable

The Python app uses `Observable[T]` with `.set()` and `.subscribe()`. In Zustand:
- `Observable.set(value)` becomes `set({ field: value })`
- `Observable.subscribe(callback)` becomes `useStore((s) => s.field)` in components, or `useStore.subscribe(selector, callback)` outside React

### 4. Wire up IPC

Ensure the corresponding IPC channel exists. If not, use `/add-ipc-channel` to create it first.

### 5. Cross-reference Python state

Read `../Fidra/fidra/state/app_state.py` to see what observables exist for this domain and replicate the same reactive data flow.
