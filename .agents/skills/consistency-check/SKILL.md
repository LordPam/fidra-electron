---
name: consistency-check
description: Audit code for consistency against Fidra-Web architectural standards and patterns
user-invocable: true
allowed-tools: Read, Grep, Glob, Bash, Edit
argument-hint: [scope: file path, directory, or "all"]
---

# Consistency Check

Run a consistency audit against `$ARGUMENTS` (a file, directory, or "all" for the whole app). Check every applicable rule below. Report violations with file:line references and suggest fixes.

## Output Format

For each rule, report:
- **PASS** if no violations found
- **WARN** with file:line and explanation if violations found
- **SKIP** if the rule doesn't apply to the scope

At the end, give a summary: "X checks passed, Y warnings, Z skipped."

---

## Rules

### Rule 1: IPC Boundary Integrity

Every `ipcMain.handle` call in `src/main/ipc/` must:
1. Call `resolveContext(event)` to get per-window context (unless the handler is window-management or app-level)
2. Parse ALL inputs with Zod (via schemas from `src/shared/ipc-schemas.ts` or inline `z.string().parse()` etc.)
3. Call repositories via `ctx.repos.*`, never by importing repos directly
4. Never pass unvalidated `unknown` to a repo method

**Check**: Read all `ipcMain.handle` calls. Flag any that skip Zod parsing or don't resolve context.

**Good** (`src/main/ipc/transactions.ts`):
```ts
ipcMain.handle('transactions:save', (event, data: unknown) => {
  const validated = transactionRowSchema.parse(data);
  const ctx = resolveContext(event);
  return ctx.repos.transactions.save(validated);
});
```

**Bad**: Using `data` directly without `.parse()`, or importing a repo class instead of going through context.

### Rule 2: Preload Type Safety

Every method in `src/preload/preload.ts` must:
1. Use `ipcRenderer.invoke('channel:name', ...)` with the exact channel name from `ipc-types.ts`
2. Accept typed parameters (not bare `any`)
3. Return `Promise<SpecificType>` where possible, or `Promise<unknown>` only when the return type varies

**Check**: Read `src/preload/preload.ts`. Flag methods that accept `any` parameters or have mismatched channel names.

### Rule 3: Renderer Isolation

Files in `src/renderer/` must NEVER import from:
- `'electron'` or `'electron/...'`
- `'fs'`, `'path'`, `'os'`, `'child_process'`, or any Node built-in
- `'better-sqlite3'`, `'pg'`, `'@supabase/...'`
- `'../../main/...'` or any main-process module
- `'../../preload/...'`

Allowed imports: React ecosystem, `src/renderer/` siblings, `src/shared/`, `@/` aliases (pointing to renderer).

**Check**: Grep for forbidden imports in `src/renderer/`.

### Rule 4: Undo Command Registration

State-changing operations must use the undo system correctly:
1. Create command via factory function in `src/renderer/services/undo.ts`
2. Register via `useUndoStore.getState().execute(command)` — the execute() method runs the command AND records it
3. Use `useUndoStore.getState().record(command)` when the operation was already performed before the command was created (e.g. drag-drop attachment add, sheet creation). This records the command for undo without re-executing.
4. NEVER push directly to `useUndoStore.setState({ undoStack: [...] })` — use `record()` instead

**Check**: Grep for `useUndoStore.setState` in `src/renderer/` (should only appear in `undo-store.ts` itself). Flag any occurrence in views, components, or services.

### Rule 5: Store Action Pattern

Zustand store actions in `src/renderer/stores/` must:
1. Be `async` if they call IPC
2. Call `window.api.*` for data access — never import main-process modules
3. Update state via `set()` after the IPC call succeeds
4. Catch errors and either set error state or re-throw
5. Never call other stores' actions directly (use undo commands or services for cross-store operations)

**Check**: Read store files. Flag actions that skip error handling or access data without IPC.

**Good** (`transaction-store.ts`):
```ts
addTransaction: async (data) => {
  try {
    const result = await window.api.saveTransaction(data);
    set((state) => ({ transactions: [result, ...state.transactions] }));
    return result;
  } catch (err) {
    set({ error: String(err) });
    throw err;
  }
},
```

### Rule 6: View Thinness

Views in `src/renderer/views/` should be presentation layers. Flag if a view:
1. Defines domain types (interfaces that aren't props) — types belong in `domain/models.ts`
2. Contains business logic functions (anything that transforms domain data beyond simple filtering) — extract to `services/`
3. Directly orchestrates multiple store mutations in sequence — use undo commands or a service
4. Exceeds ~500 lines without clear justification — consider extracting logic

**Check**: Read view files. Flag domain type definitions, helper functions with business logic, and multi-store mutation sequences.

**Known thick views**: `ActivitiesView.tsx` (~986 lines, owns rename/delete propagation), `InvoicesView.tsx` (~1070 lines, owns invoice number generation and localStorage persistence).

### Rule 7: Sheet Scoping

Views that read transactions, planned templates, or financial data must:
1. Subscribe to `useSheetStore` for `currentSheet`
2. Pass sheet filter to data-loading calls
3. Filter displayed data by `currentSheet` (or explicitly document why it's global)

Views that are intentionally global (Settings, Invoices) should not filter by sheet.

**Check**: For each view, verify sheet-scoping is intentional. Flag views that read transaction data without sheet filtering.

### Rule 8: Settings Persistence Mode

Settings must use the correct persistence mode:
- **Global UI prefs** (theme, zoom, recent files): `window.api.saveUiPreferences()` → `~/.fidra/settings.json`
- **Per-database config** (profile, FY month, tx behavior): `window.api.save*Setting()` → SQLite `settings` table
- **NEVER** use `localStorage` for domain data (invoice builder state is a known exception pending migration)

**Check**: Grep for `localStorage.setItem` and `localStorage.getItem` in `src/renderer/`. Flag any usage outside the known invoice exception.

### Rule 9: Type Safety

1. No `any` types in `src/renderer/`, `src/main/`, or `src/shared/` except:
   - At IPC system boundaries in preload (where `unknown` is preferred over `any`)
   - In type assertions with a comment explaining why (`as SomeType // safe because...`)
2. Domain types live in `src/renderer/domain/models.ts` or `src/shared/ipc-types.ts`
3. Zod schemas for IPC inputs live in `src/shared/ipc-schemas.ts`
4. Types defined only in a view file are a smell — they should be in domain/models if used for data

**Check**: Grep for `: any` and `as any` in source files. Flag bare `any` without justification.

### Rule 10: Debug Code

No `console.log` or `console.warn` in production code paths except:
- `[LISTEN]` prefixed logs in change-listener.ts (operational logging)
- `[CLOUD]` prefixed logs in cloud sync (operational logging)
- `console.warn` in `silentRefresh` catch blocks (expected)

**Check**: Grep for `console.log` in `src/renderer/services/`, `src/renderer/stores/`, and `src/renderer/views/`. Flag any that look like debug logging (especially `[Undo Convert]` or `[TransactionStore]` prefixed messages).

### Rule 11: CSS Animation Consistency

Animation-related DOM attributes must use the established conventions:
- `data-row-deleting` for delete sweep (targets `[data-row-deleting]` in globals.css)
- `data-row-new` for new row entrance
- `data-row-selected` for selection highlight
- `data-row-focused` for focus ring
- `data-row-just-approved` / `data-row-just-rejected` for approval animations
- `data-table-unfocused` on `<table>` for dimmed selection when table loses focus

**Check**: Grep for `data-row-` and `data-table-` attributes. Flag any custom animation attributes not in the standard set.
