---
name: add-undo-command
description: Make an operation undoable by creating an undo command with proper execute/undo symmetry
user-invocable: true
allowed-tools: Read, Grep, Glob, Write, Edit
argument-hint: <operation description, e.g. "rename activity" or "change FY month">
---

# Add Undo Command

Make the operation `$ARGUMENTS` undoable by creating a command factory and wiring it through the undo system.

## Process

### Step 1: Understand the operation

Find where `$ARGUMENTS` is currently implemented. Read:
- The event handler or callback that triggers it
- The store action(s) it calls
- The IPC channel(s) involved
- What state changes when the operation runs

Identify: What data needs to be captured BEFORE the operation so it can be reversed?

### Step 2: Create the command factory

Add a factory function to `src/renderer/services/undo.ts`:

```ts
export function create<Operation>Command(
  // Parameters: snapshots of state before the operation
): UndoCommand {
  return {
    description: `<Human-readable description>`,
    execute: async () => {
      // Apply the forward operation using store actions
      // NEVER call window.api directly — always go through store actions
    },
    undo: async () => {
      // Reverse the operation using store actions
      // Must fully restore the previous state
    },
  };
}
```

### Step 3: Ensure symmetry

The `execute` and `undo` functions must be perfect inverses:

| execute does | undo must do |
|---|---|
| `addTransaction(tx)` | `removeTransaction(tx.id)` |
| `removeTransaction(id)` | `restoreTransaction(snapshot)` |
| `updateTransaction(newData)` | `restoreTransaction(oldData)` |
| `bulkUpdate(newItems)` | `bulkUpdate(oldItems)` |

Key patterns:
- **Create**: undo = delete. Capture the created item's data.
- **Delete**: undo = restore. Capture the full item data + any cascade data (attachments, linked items).
- **Update**: undo = restore previous version. Capture the old data.
- **Bulk**: same as single, but with arrays.
- **Cross-store**: if execute touches multiple stores, undo must touch the same stores in reverse order.

### Step 4: Handle version conflicts

For cloud-synced entities, the `CachingRepo.save()` auto-bumps versions to prevent conflicts. But the undo command should still increment the version in its data:

```ts
undo: async () => {
  // restoreTransaction handles version bumping internally
  await useTransactionStore.getState().restoreTransaction(oldSnapshot);
},
```

Use `restoreTransaction` / `restoreTemplate` (not `updateTransaction`) for undo — these methods clear `recentlyDeleted` protection and handle the case where the item may have been re-added by cloud sync.

### Step 5: Wire the call site

At the point where the operation is triggered (view handler, dialog callback):

```ts
// CORRECT: use execute() which runs the command AND records it
await execute(createSomeCommand(snapshot));

// WRONG: never push directly to undo store state
useUndoStore.setState(state => ({
  undoStack: [...state.undoStack, cmd],  // ANTI-PATTERN
}));
```

If the operation is already happening before the command is created (e.g., an attachment was already uploaded), restructure so the command's `execute` performs the operation.

### Step 6: Handle side effects

Some operations have side effects that can't be undone:
- **Audit log entries**: Don't undo these — they're a permanent record
- **Cloud sync**: The sync queue handles this — undo generates new sync events
- **File operations**: For attachments, use `restoreAttachment` / `removeAttachment` which manage the `.trash/` directory

### Step 7: Verify

1. Run `npx tsc --noEmit`
2. Test: execute the operation, verify it works
3. Test: undo (Cmd+Z), verify state is fully restored
4. Test: redo (Cmd+Shift+Z), verify the operation re-applies
5. Test: undo while cloud-connected, verify no resurrection via `silentRefresh`

### Existing commands for reference

See `src/renderer/services/undo.ts` for all existing patterns:
- Simple CRUD: `createAddTransactionCommand`, `createDeleteTransactionCommand`
- Bulk: `createBulkDeleteCommand`, `createBulkEditCommand`
- Cross-store: `createConvertPlannedCommand` (touches transaction + planned + invoice stores)
- With cascading data: `createDeleteSheetWithDataCommand` (captures transactions, templates, attachments)
- With side effects: `createAddAttachmentCommand` (takes `onRefresh` callback)
