---
name: audit-view
description: Audit a specific view for consistency against the app-wide interaction contract and standards
user-invocable: true
allowed-tools: Read, Grep, Glob
argument-hint: <ViewName, e.g. "PlannedView" or "ActivitiesView">
---

# Audit View

Audit `$ARGUMENTS` for consistency against Fidra-Web's established patterns. Compare it to the gold standard (TransactionsView) and report gaps.

## Checklist

Read the view file thoroughly, then evaluate each category:

### 1. Data Loading

- [ ] Subscribes to `useSheetStore` for `currentSheet` (if sheet-scoped)
- [ ] Calls `loadAll()` on mount and when `currentSheet` changes
- [ ] Calls `loadSheets()`, `loadCategories()`, `loadPlanned()` as needed on mount
- [ ] Does NOT fetch data in event handlers (fetches happen in useEffect or store actions)

**Standard pattern** (`TransactionsView.tsx:113-121`):
```ts
useEffect(() => { loadSheets(); loadCategories(); loadPlanned(); }, [...]);
useEffect(() => { loadAll(currentSheet === 'All Sheets' ? undefined : currentSheet); }, [currentSheet, loadAll]);
```

### 2. Sheet Scoping

- [ ] If the view shows financial data: filters by `currentSheet`
- [ ] If the view is global: documents why (e.g., invoices are not sheet-scoped)
- [ ] Shows sheet column only when `currentSheet === 'All Sheets'` and 2+ sheets exist
- [ ] Passes sheet filter to IPC calls that load data

### 3. Undo Integration

- [ ] Imports undo command factories from `services/undo.ts`
- [ ] Registers commands via `useUndoStore.execute()` (not direct `setState`)
- [ ] All data mutations (add, edit, delete) are undoable
- [ ] Cmd+Z and Cmd+Shift+Z keyboard shortcuts are wired

Report which operations are undoable and which bypass the undo system.

### 4. Keyboard Shortcuts

Compare to TransactionsView baseline:

| Shortcut | TransactionsView | This view | Gap? |
|---|---|---|---|
| Cmd+Z / Cmd+Shift+Z | Undo/redo | ? | |
| Arrow Up/Down | Navigate rows | ? | |
| Shift+Arrow | Range select | ? | |
| Escape | Deselect / close panel | ? | |
| Enter | Edit focused row | ? | |
| Delete | Delete selected | ? | |
| A/a | Approve | ? | |
| R/r | Reject | ? | |
| E/e | Edit/bulk edit | ? | |

Not all shortcuts apply to all views. Report which ones make sense but are missing.

### 5. Table Interaction Model

If the view has a table or list:

- [ ] **Selection**: Click to select? Multi-select? Shift+click range?
- [ ] **Focus management**: Imperative (refs) or React state? Is focus visually indicated?
- [ ] **Context menu**: Right-click menu with relevant actions?
- [ ] **Edit trigger**: Double-click? Enter key? Edit button?
- [ ] **Delete animation**: Uses `data-row-deleting` attribute and `deleteSlide` keyframe?
- [ ] **New row animation**: Uses `data-row-new` attribute?
- [ ] **Selection highlight**: Uses `data-row-selected` and `data-row-focused` attributes?

### 6. Domain Logic Location

- [ ] View does NOT define domain types (interfaces for non-prop data)
- [ ] View does NOT contain helper functions with business logic
- [ ] View does NOT orchestrate multi-store mutations inline
- [ ] Complex calculations are delegated to services

If violations exist, list them with line numbers and suggest where to extract them.

### 7. Error Handling

- [ ] View is wrapped in `<ErrorBoundary>` in App.tsx
- [ ] Store actions that the view calls have try/catch with error state
- [ ] Loading state is shown while data is being fetched

### 8. Header Pattern

Compare to established header layout:
- Left: View title (static or dynamic)
- Right: Action buttons, separators, undo/redo, zoom controls
- Consistent spacing, button sizes, separator divs

### 9. Side Panels / Secondary Content

If the view has side panels:
- [ ] Panel slides in/out smoothly (CSS transition, not mount/unmount)
- [ ] Panel follows selection state where appropriate
- [ ] Panel has a close mechanism (X button or Escape)

### 10. Settings Dependencies

- [ ] Does the view read any settings? Which persistence mode?
- [ ] Are settings fetched via IPC (correct) or from localStorage (usually wrong)?
- [ ] Does the view write settings? Through which path?

## Output

Produce a report with:

1. **Score**: How many of the applicable checks pass
2. **Critical gaps**: Things that break the interaction contract or violate architecture
3. **Improvement opportunities**: Things that would bring the view closer to TransactionsView quality
4. **OK as-is**: Things that are intentionally different (with explanation)
