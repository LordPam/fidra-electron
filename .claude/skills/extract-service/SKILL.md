---
name: extract-service
description: Extract domain logic from a view into a shared service with proper undo integration
user-invocable: true
allowed-tools: Read, Grep, Glob, Write, Edit, Bash
argument-hint: <ViewName or description of logic to extract>
---

# Extract Service from View

Extract domain logic related to `$ARGUMENTS` from a view into a proper service layer.

## Why

Views should be thin presentation layers. When a view owns business logic — multi-store mutations, domain calculations, data transformations — that logic becomes untestable, unreusable, and inconsistent with the rest of the app.

## Process

### Step 1: Identify the domain logic

Read the target view file. Look for:
- **Multi-store mutations**: Code that calls actions on 2+ Zustand stores in sequence (e.g., updating transactions AND planned templates)
- **Domain type definitions**: Interfaces defined in the view that aren't React props (should be in `src/renderer/domain/models.ts`)
- **Business logic functions**: Helper functions that transform domain data (status inference, aggregation, date parsing)
- **Direct IPC calls**: `window.api.*` calls in event handlers instead of going through store actions
- **Undo command construction**: Building undo commands with inline data snapshots

List each piece of extractable logic with its line range.

### Step 2: Design the service

Create a service file at `src/renderer/services/<domain>.ts`. The service should:
- Export pure functions for calculations and transformations
- Export async functions for operations that involve IPC + state updates
- Accept store references or data as parameters — don't import stores directly inside pure functions
- For operations that need undo: create command factories in `src/renderer/services/undo.ts`

### Step 3: Extract domain types

If the view defines interfaces that represent domain data (not React props), move them to `src/renderer/domain/models.ts` and update imports.

### Step 4: Create undo commands

For operations that mutate data across stores, create command factories in `src/renderer/services/undo.ts` following the existing pattern:

```ts
export function createRenameActivityCommand(
  oldName: string,
  newName: string,
  // ... snapshots of affected data
): UndoCommand {
  return {
    description: `Rename activity: ${oldName} → ${newName}`,
    execute: async () => {
      // Call store actions to apply the change
    },
    undo: async () => {
      // Call store actions to reverse the change
    },
  };
}
```

Key rules:
- Commands must be registered via `useUndoStore.getState().execute(command)` — never via direct `setState()`
- `execute` and `undo` must be symmetric: what execute creates, undo destroys
- Capture all necessary data in the closure at command creation time
- Use store actions (not direct IPC calls) inside commands

### Step 5: Update the view

Replace the extracted logic with calls to the new service. The view should now:
- Import service functions instead of owning them
- Import types from `domain/models.ts`
- Call `execute(createSomeCommand(...))` for undoable operations
- Be measurably shorter and simpler

### Step 6: Verify

1. Run `npx tsc --noEmit` to confirm type safety
2. Check that undo/redo works for all extracted operations
3. Run `/consistency-check` on the modified files to verify they follow standards

### Example: What extraction looks like

**Before** (in view):
```tsx
// View directly orchestrates rename across 2 stores + notes
const oldTxns = transactions.filter(t => t.activity === oldName);
const newTxns = oldTxns.map(t => ({ ...t, activity: newName, version: t.version + 1 }));
const oldTemplates = templates.filter(t => t.activity === oldName);
const newTemplates = oldTemplates.map(t => ({ ...t, activity: newName }));
await transactionStore.bulkUpdate(newTxns);
await plannedStore.bulkUpdateTemplates(newTemplates);
await window.api.saveActivityNote(newName, noteText);
await window.api.deleteActivityNote(oldName);
```

**After** (view calls service):
```tsx
await execute(createRenameActivityCommand(oldName, newName, oldTxns, newTxns, oldTemplates, newTemplates, noteText, refreshNotes));
```
