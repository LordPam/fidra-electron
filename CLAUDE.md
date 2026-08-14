# Fidra-Web

Fidra-Web is a desktop financial ledger app (Electron + React + TypeScript). Originally ported from a Python/PySide6 app at `../Fidra/fidra/`.

## Status

Core product is implemented: 7 views (Transactions, Planned, Activities, Dashboard, Reports, Invoices, Settings), multi-window with per-window SQLite, authentication, attachments, undo/redo, PDF export. **Local Sync** (shared OneDrive folder, cr-sqlite CRDTs) is the sole sync backend — see [Local Sync](#local-sync). A prior Postgres backend ("Cloud Connect") was deprecated and removed in July 2026; it had no users. Active work is data-layer hardening, consistency, bug fixing, and architectural cleanup. See [Backlog](#backlog) for specific items.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (strict mode), no `any` except at system boundaries |
| UI | React 18, Zustand stores, Tailwind CSS 4, shadcn/ui |
| Desktop | Electron + Electron Forge, Vite for renderer |
| Database | better-sqlite3 (main process), Drizzle ORM |
| Sync | cr-sqlite (CRDTs), chokidar (file watching), AES-256-GCM (bundle encryption) |
| Validation | Zod at all IPC boundaries |
| Charts | Recharts |
| Icons | Lucide React |
| Router | React Router v7 |

## Architecture

### Product Invariants

These are non-negotiable constraints. Every change must preserve them.

1. **Local SQLite is the operational store.** All reads hit local SQLite. Sync is async, non-blocking, and optional. Sync failure must never block local workflows.
2. **Renderer never does direct DB or file I/O.** All data access goes through typed IPC via `window.api`. No Electron or Node imports in `src/renderer/`.
3. **IPC is the contract.** Channels typed in `src/shared/ipc-types.ts`, inputs validated with Zod in main-process handlers. When IPC types change, both sides update together.
4. **Sheet scoping must be explicit.** Views that filter by sheet should do so visibly. Cross-sheet operations must be intentional.
5. **Undoable operations use command abstractions.** Data mutations should go through `services/undo.ts` command factories and `useUndoStore.execute()`. Direct state mutation for undoable actions is an anti-pattern.
6. **Multi-window correctness is first-class.** Each BrowserWindow has its own SQLite connection and repo instances via `WindowContext`. IPC handlers resolve per-window context via `resolveContext(event)`.
7. **Sync mode is immutable per database file.** A database file is either standalone or Local Sync — never switchable at runtime. Joining Local Sync creates a new database file and copies data across (`joinLocalSync` in `src/main/sync/migration.ts`); it never converts a file in place. All Local Sync code lives in `src/main/sync/`. Renderer never imports Node fs/path or sync internals.
8. **Critical-field conflicts require manual review.** Sync must never silently overwrite amount, date, type, status, sheet, or party on transactions (or equivalent critical fields on other entities). Conflicting changes to these fields are queued for human resolution.
9. **Local Sync bundles are encrypted and signed.** All data leaving the local machine for the shared OneDrive folder is AES-256-GCM encrypted and HMAC signed. Corrupted or tampered bundles are rejected.

### When Changing Behaviour

- **Prefer shared services/commands over view-local orchestration.** If a view is doing multi-store mutations, that logic belongs in a service.
- **Preserve local-first behavior.** Never make local operations depend on sync state.
- **Do not bypass typed IPC.** If you need new data access, add a channel.
- **Keep sync optional.** Features must work on a standalone database with no sync folder configured.
- **Treat multi-window as a constraint, not an afterthought.** State that looks global might be per-window.
- **Prefer explicit domain rules over implicit UI-state rules.** If a business rule is embedded in a `useMemo` or view state, consider extracting it to a domain function.

### Key Patterns

| Pattern | Location |
|---------|----------|
| Per-window context | `WindowContext` in `src/main/window/window-context.ts`, resolved via `resolveContext(event)` in `src/main/ipc/context-resolver.ts` |
| Repository layer | Class-based repos in `src/main/repositories/`, bundled per-window by `RepoSet` in `src/main/repositories/repo-set.ts` |
| Undo commands | Factory functions in `src/renderer/services/undo.ts`, executed via `useUndoStore.execute(command)` |
| Local Sync | cr-sqlite CRRs + merge gate (merge engine), encrypted bundles via shared folder (transport), chokidar + polling (detection) |
| Error boundaries | Every view wrapped in `<ErrorBoundary>` in `App.tsx` |
| Global settings | `~/.fidra/settings.json` for cross-database prefs (theme, recent files) |
| Per-db settings | SQLite `settings` table for database-specific config (profile, FY month, tx behavior) |
| Money | `src/shared/money.ts` — stored as TEXT `"0.00"`, computed in integer pence. Never `parseFloat` an amount |
| Referential guards | `src/main/services/referential-integrity.ts`, called from IPC handlers only — never from repos, so Local Sync's `crsql_changes` path stays unguarded |

### Directory Structure

```
src/
├── main/              # Electron main process
│   ├── database/      # SQLite + Drizzle (connection.ts, schema.ts, settings-repo.ts)
│   ├── ipc/           # IPC handlers, one per domain + context-resolver.ts
│   ├── repositories/  # Local SQLite repos (class-based, injected Database) + RepoSet
│   ├── sync/          # Local Sync: cr-sqlite CRRs, merge gate, bundle transport, conflict queue
│   ├── window/        # WindowManager, WindowContext, global-settings
│   ├── menu/          # Native menu bar
│   └── services/      # Main-process services (attachments, audit, session store)
├── renderer/          # React app (Vite-built)
│   ├── domain/        # TypeScript types, Zod schemas
│   ├── stores/        # Zustand stores (one per domain slice)
│   ├── services/      # Renderer-side logic (search, balance, forecast, undo, export)
│   ├── views/         # 7 top-level view components
│   ├── components/    # Reusable UI (TransactionTable, SearchBar, AttachmentPanel, etc.)
│   ├── dialogs/       # 18 modal dialog components
│   ├── lib/           # Utilities (format, dates, currency)
│   └── styles/        # globals.css (Tailwind + design tokens + animations)
├── shared/            # Types shared between main and renderer (ipc-types, ipc-schemas)
└── preload/           # contextBridge (preload.ts)
```

## Progress Tracking

**Rule:** Before returning any response that completes or advances a backlog item, update the Backlog section below to reflect the new status. Use these markers:
- `[x]` — completed
- `[>]` — in progress (currently being worked on this session)
- `[ ]` — not started

This ensures every session leaves CLAUDE.md as the single source of truth for project status.

## Coding Conventions

- **Files**: `kebab-case.ts` for utilities, `PascalCase.tsx` for React components
- **Exports**: Named exports only (no default exports) except for page-level views
- **Types**: Interfaces for props, Zod schemas for runtime data
- **Error handling**: Result types at service boundaries, try/catch only in IPC handlers
- **No barrel files**: Import directly from source modules
- **Tests**: Vitest for unit/integration (`npm test`), Playwright for E2E against the real Electron app (`npm run test:e2e`). Both scripts rebuild better-sqlite3 for the runtime they need — it cannot serve Node and Electron at once. E2E runs against the last **build**, so `test:e2e` packages first; see `e2e/README.md`
- **TypeScript**: `npx tsc --noEmit` must pass after every refactor

## Key Domain Models

- **Transaction**: id, date, description, amount, type (INCOME|EXPENSE), status (AUTO|PENDING|APPROVED|REJECTED|PLANNED), sheet, category, party, reference, activity, notes, version, timestamps
- **PlannedTemplate**: id, start_date, description, amount, type, target_sheet, frequency (ONCE|WEEKLY|BIWEEKLY|MONTHLY|QUARTERLY|YEARLY), end_date/occurrence_count, skipped_dates, fulfilled_dates
- **Sheet**: id, name, is_virtual, is_planned
- **Category**: id, name, type, color
- **Attachment**: id, transaction_id, filename, stored_name, mime_type, file_size
- **Invoice**: id, invoice_number, date, due_date, status, party, items, subtotal, tax, total, notes, timestamps
- **AuditEntry**: id, timestamp, action, entity_type, entity_id, user, summary, details

## Local Sync

Local Sync is Fidra's only sync backend. It is file-based peer-to-peer sync for organisations that cannot give data to third-party services (e.g., university clubs on institutional OneDrive). A shared OneDrive folder acts as a dumb mailbox — no server, no accounts, no third-party data processing. Sync is optional; the app works fully offline as a standalone database.

**Status:** Implemented (phases 0–8 complete). Full design in `memory/sync-architecture.md` — read it before any Local Sync work.

**Architecture:** cr-sqlite CRRs (merge engine) + pre-merge gate (critical-field conflict detection → manual review queue) + encrypted bundle transport via shared folder + chokidar file watching + polling fallback.

**Code:** `src/main/sync/`

**Sync mode immutability:** A database file is either standalone or Local Sync, decided at the moment it joins a sync folder and never changed afterwards. Joining runs `joinLocalSync` (`src/main/sync/migration.ts`), which creates a clean database file and copies data in, so CRRs are initialised from scratch. Converting an existing file in place is not supported: CRR initialisation on pre-existing rows produces `col_version=1` values that silently lose against established peer version histories. `syncFolderHasExistingPeers` in `localSync:configure` guards against pointing a fresh file at a folder that already has peers.

**Auth:** Fidra-native, no external provider. Identity and authorization come from the local `personnel` table, with a device→personnel mapping and admin/member roles. Sessions persist encrypted via Electron `safeStorage`. Personnel management handlers live in `src/main/ipc/personnel.ts` (admin-only, with last-admin and self-removal guards).

**Key decisions:**
- cr-sqlite as merge engine (CRDTs, version vectors, causal ordering)
- Pre-merge gate: critical-field conflicts → manual review queue, everything else → auto-merge via cr-sqlite
- Bundles are gzipped JSON, AES-256-GCM encrypted, HMAC signed
- Compaction via high-water marks + snapshots for new-device onboarding
- **Full org-wide sync**: all org-relevant data syncs, not a subset

**Synced tables (CRRs):**
- `transactions`, `planned_templates`, `sheets`, `categories`, `invoices`, `activity_notes` — core ledger data
- `personnel` — identity and roles
- `attachments` — metadata via CRR bundles, actual files via encrypted file transport in shared folder
- `audit_log` — org-wide accountability, append-mostly
- `settings` — only keys tagged with `scope = 'org'` (e.g., FY month, org name). Keys with `scope = 'device'` (theme, window prefs) stay local.

**Not synced (per-device):**
- `settings` rows with `scope = 'device'`
- `applied_bundles`, `sync_conflicts` — Local Sync internal plumbing

**Critical fields (manual review required on conflict):**
- Transaction: amount, date, type, status, sheet, party
- PlannedTemplate: amount, start_date, type, frequency, target_sheet
- Invoice: subtotal, date, due_date, status, to_name
- Sheet: name
- Personnel: name, role, email

## Current Priorities

Work in this order when choosing what to improve:

1. ~~**Eliminate domain logic from views.**~~ Done. ActivitiesView domain logic extracted to `services/activity.ts` and `services/activity-aggregation.ts`. View now only contains UI orchestration (selection, animation, keyboard nav, chart shaping).
2. **Standardise undo participation.** Some domains bypass `execute()` and mutate `useUndoStore` directly. Some operations (settings, invoice builder state) have no undo at all.
3. ~~**Harden startup/auth/session restoration.**~~ Done. Single entry point `auth-store.initialize()` handles hydration with `isHydrated` state machine. `useAuthGate` reads from auth-store instead of calling IPC directly. Event listeners registered synchronously before async IPC to close race window.
4. **Reduce duplicated view patterns.** Sheet-filtering useMemo, data-loading useEffect, undo/redo header buttons, zoom controls — all copy-pasted across 3-5 views.
5. **Improve consistency across table-like views.** TransactionTable has full keyboard nav, multi-select, context menus, animations. Planned and Activities have partial or ad hoc implementations. No shared interaction contract.
6. **Fix settings persistence boundaries.** Three modes (per-db SQLite, global JSON, localStorage) with unclear ownership. Invoice builder state in localStorage is fragile and unsynced.
7. **Prefer explicit domain rules over implicit UI-state rules.** Activity status inference, invoice number generation, and activity date parsing are embedded in views, not domain functions.
8. ~~**Fix fragile Electron-specific behaviours.**~~ Done. DropZone now uses `webUtils.getPathForFile()` exposed via preload contextBridge instead of deprecated `File.path`.

## Known Weak Spots

Consult `memory/architecture-audit.md` for detailed analysis with file:line references.

- ~~**Activities workflow is view-heavy**~~: Done — domain logic extracted to `services/activity.ts` + `services/activity-aggregation.ts`
- ~~**Auth restoration has edge cases**~~: Done — single `auth-store.initialize()` entry point with `isHydrated` state machine; `useAuthGate` reads store instead of IPC; event listeners registered before async work
- ~~**Drag-drop attachments are fragile**~~: Fixed — uses `webUtils.getPathForFile()` via preload; pulse animation on drag-over; success flash on attach
- **Undo coverage is incomplete**: Settings changes, invoice builder edits have no undo; AttachmentPanel and ActivitiesView bypass `execute()` and push directly to undo store state
- **Settings/identity ownership is uneven**: Profile is per-db but semantically per-user; FY month exists in both per-db SQLite and global JSON; invoice builder state in localStorage
- **Data-layer integrity gaps**: ~~unversioned non-transactional migrations~~ (6a), ~~`parseFloat(x) || 0` money arithmetic~~ (6d — use `src/shared/money.ts`), ~~no referential guards~~ (6f — app-level, in handlers; cr-sqlite forbids FKs and UNIQUE on CRRs), ~~non-atomic multi-row ops~~ (6b), ~~shape-only Zod IPC validation~~ (6e), ~~thin test coverage outside `sync/`~~ (6g — 421 tests across 34 files). The Cloud-removal + hardening plan (phases 1–6g) is complete; detail in `plan-cloud-removal-hardening.md`.

## Backlog

### Cloud Connect removal + data hardening (complete — decided 2026-07-27, finished 2026-08-12)

Cloud Connect is **deprecated**: no existing users, unmaintained, being removed entirely. Local Sync becomes the sole sync backend. Full plan with rationale and file-level detail lives in the persistent memory file `plan-cloud-removal-hardening.md`; execution is tracked in the session task tracker (rebuild it from the plan file if empty).

- [x] Phase 1 — Remove Cloud Connect from main process. `src/main/cloud/` deleted (~5,900 lines); SessionStore moved to `src/main/services/session-store.ts`, RepoSet to `src/main/repositories/repo-set.ts`; WindowContext/WindowManager rewritten cloud-free; cloud IPC handlers, menu entry, OAuth deep-link, and pg error suppression removed; `localSync:migrateFromCloud` retired. Renderer/preload/shared cloud surface still present (Phase 2). Also fixed 3 stale test fixtures + 1 flaky tiebreaker test. 251/251 tests green.
- [x] Phase 2 — Remove Cloud Connect from renderer. Deleted cloud-store, CloudServerDialog, MigrateToLocalSyncDialog, ConflictResolutionDialog, ConnectionIndicator, SignInDialog (~1,600 lines). auth-store rewritten Local-Sync-only (491→262 lines; Supabase sign-in/sign-up/OAuth/admin-setup and cloud hydration removed). AuthGateDialog, SetupWizard, FileChooserDialog, SettingsView, Sidebar, InvitePersonnelDialog de-branched. Preload/shared cloud surface removed (`cloud:*`, `sync:*`, `connection:*`, `auth:*`, `window:*CloudServer*`, `personnel:invite`, `localSync:migrateFromCloud`; CloudServerConfig/CloudStatus/SyncConflict types, cloudServerConfigSchema, GlobalSettings.cloudServers/activeServerId). `AuthMode` narrowed to `'localSync'`. New `src/main/ipc/personnel.ts` replaces the deleted cloud-side personnel handlers (getAll/remove/updateRole) with admin-only, last-admin and self-removal guards plus audit logging. 251/251 tests green, tsc clean.
- [x] Phase 3 — Remove supabase/pg deps; rewrite CLAUDE.md for single sync backend. Dropped `@supabase/supabase-js`, `pg`, `@types/pg` from package.json (15 packages removed on clean install); removed `pg` from the Vite main-process externals list and the Forge `nativeModules` copy list. CLAUDE.md de-branched throughout: Status, Tech Stack, invariants 1/7/8, "When Changing Behaviour", Key Patterns, directory tree, Current Priorities #6, Known Weak Spots, and the dual-backend "Sync Backends" section collapsed into a single "Local Sync" section. tsc clean, 251/251 tests green, `npm run build:demo` succeeds.
- [x] Phase 4 — Website: dropped Cloud Connect from `gh-pages/`. `cloud-connect.html` replaced with a noindex meta-refresh stub → local-sync.html. index.html: Cloud Connect sync card + `.sync-badge.cloud` CSS removed, `.sync-grid` collapsed to one column (max-width 920→560px), two FAQ answers reworded. local-sync.html: nav/footer/hero/CTA de-branched. Docs are **generated** — edited the markdown sources in `docs/` (deleted `setup/cloud-connect.md`, de-branched README/personnel-and-approvals/treasurer-handover) plus `docs-preview/template.html` and `docs-preview/shell.js` (nav), then regenerated with `zsh scripts/build-docs-preview.sh` (needs pandoc). Also re-synced the stale `AGENTS.md` mirror from CLAUDE.md.
- [x] Phase 5 — Fix `transfer_target_sheet` cascade bug in sheet-repo (rename/merge/delete) + regression test. Sheets are referenced by NAME in three columns, but only `transactions.sheet` and `planned_templates.target_sheet` cascaded. `renameSheet` and `mergeAndDelete` now also repoint `planned_templates.transfer_target_sheet`; `deleteWithTransactions` NULLs it out (a template on a surviving sheet keeps existing, minus its now-dangling destination). `getPlannedOnSheet` widened to `target_sheet = ? OR transfer_target_sheet = ?` so the undo snapshots taken in TransactionsView capture transfer-referencing templates and can restore them. Mirrored in `demo/mock-api.ts`. New `src/main/repositories/__tests__/sheet-repo.test.ts` (9 cases). tsc clean, 260/260 tests green.
- [x] Phase 6a — Wrap `runMigrations` in a transaction; fix hardcoded copy-column drift in migrateCrrDefaults. `runMigrations` is now a thin transactional wrapper around `applyMigrations`, so a failure part-way through can no longer leave a `DROP`ped table without its `RENAME` (verified: the rollback test fails if the wrapper is removed). New `copyCommonColumns(sqlite, from, to)` derives the copy list from the live schema — used by all five rebuild sites (migrateCrrDefaults' 7 tables, settings + personnel PK rebuilds, sheets + categories UNIQUE rebuilds), replacing hardcoded lists that omitted `linked_id` and `transfer_target_sheet` and three hand-written personnel column branches. New `run-migrations.test.ts` drives the real `openDatabase` against a hand-built legacy database file (4 cases). tsc clean, 264/264 tests green.
- [x] Phase 6b — Atomic multi-row ops (saveTransfer, delete + counterpart, files deleted after DB commit). New `TransactionRepo.saveTransfer` wraps both halves in one DB transaction (a half-saved transfer silently loses money). `transactions:delete` and `:bulkDelete` now run all row deletions — attachments plus both sides of a transfer — inside `ctx.sqlite.transaction`, and move attachment files to `.trash` only after it commits; `attachment-service.removeAllForTransaction` was split into the DB half (repo) and `moveAttachmentFilesToTrash` (files). `bulkRemove([])` returns 0 instead of emitting invalid `IN ()` SQL, and `:bulkDelete` short-circuits on an empty id list. New `transaction-repo.test.ts` (4 cases). tsc clean, 268/268 tests green.
- [x] Phase 6c — Backup restore: remove stale -wal/-shm, multi-window guard. `restoreBackup` now deletes the `-wal`/`-shm` sidecars after closing and before copying the backup over the live file (left in place they get replayed over the restored database). `backup:restore` refuses to run while another window holds the same file — `WindowManager.otherWindowsWithFile` compares `fs.realpathSync.native`, catching the case-variant and symlink spellings that `dbPathIndex` treats as different files — and stops Local Sync before the swap. Also fixed a latent bug: the old handler called `switchWindowToFile(id, ctx.dbPath)`, which short-circuits when the path is unchanged, so after a restore the window kept a **closed** SQLite handle and every later query threw. New `WindowManager.reopenWindowDatabase` rebuilds the context in place, and runs whether the restore succeeded or failed (the connection is closed either way). New `backup-service.test.ts` (4 cases). tsc clean, 272/272 tests green.
- [x] Phase 6d — Shared `money.ts` (strict parse → integer pence internally; TEXT "0.00" storage unchanged); replace ~30 `parseFloat || 0` sites. New `src/shared/money.ts`: `parsePence` (strict — `null` rather than a silent zero; rejects `"12abc"`, `"1,234.56"`, `"1e3"`, which `parseFloat` half-reads), `toPence`/`toAmount` (0 fallback, for reading rows already in the database), `sumPence`/`sumAmounts` (add in integer pence, divide once), `penceToAmount`/`toAmountString` (storage format), `isValidAmount`/`isPositiveAmount`. 75 of 80 `parseFloat` call sites replaced across 25 files. Accumulators converted to pence where drift compounds: `balance.ts` (running balances down the whole ledger), `forecast.ts` (projections), `report-builder.ts`, and the reduce-based totals in `report-analysis.ts`/`report-html.ts`. Form validation and save normalisation now go through `isPositiveAmount` + `toAmountString`, so `parseFloat(x).toFixed(2)` can no longer store the string `"NaN"`. Deliberately left: 3 live numeric `<input>` handlers (strict parsing would reset the field to 0 mid-typing, e.g. while "12." is on screen) and `csv-parser`'s locale-aware separator handling. New `money.test.ts` (18 cases) and `balance.test.ts` (8 cases). tsc clean, 298/298 tests green, `build:demo` OK.
- [x] Phase 6e — Tighten Zod IPC schemas (amount format, ISO dates, non-empty ids). Row schemas now validate *values*, not just shape: `idSchema` (non-empty, also for `linked_id`/`transaction_id`/`planned_template_id`), `amountSchema` (delegates to `money.isValidAmount`, so `"NaN"`/`"12abc"` can no longer be stored), `dateSchema` (`YYYY-MM-DD` **and** a date that exists — `new Date('2026-02-31')` silently rolls to 3 March), `timestampSchema`, `jsonDateArraySchema` for `skipped_dates`/`fulfilled_dates` and `lineItemsSchema` for `line_items` (both are `JSON.parse`d by callers that would throw), `sqliteBooleanSchema` for 0/1 flags, and a no-path-separators rule on `attachments.stored_name` (it is resolved against the attachment directory). Loose `z.string().parse(id)` in the sheets/transactions/planned/invoices/attachments/audit handlers replaced with `idSchema`/`nameSchema`. CSV import now validates the rows it assembles before `bulkSave` — previously the only transaction writer with no row validation. New `ipc-schemas.test.ts` (17 cases) and `schema-conformance.test.ts`, which validates the demo dataset against the schemas as a guard against locking out data the app itself writes. tsc clean, 319/319 tests green.
- [x] Phase 6f — App-level referential guards (sheet-exists on save, duplicate-name checks, orphan sweep). New `src/main/services/referential-integrity.ts` stands in for the FK and UNIQUE constraints cr-sqlite forbids. `assertSheetsExist` guards `transactions:save`/`:bulkSave`/`:saveTransfer`, `planned:save`/`:bulkSave` (both `target_sheet` and `transfer_target_sheet`) and CSV import — a transaction naming a missing sheet doesn't dangle visibly, it just stops appearing anywhere, because every view filters by sheet. `assertSheetNameAvailable` guards `sheets:create`/`:rename` and compares case-insensitively ("Main" and "main" would be two sheets that look identical in the sidebar and silently split a ledger); a rename can still keep or recapitalise its own name. `categories:setAll` dedupes case-insensitively. **The guards live in IPC handlers, not repositories, deliberately**: Local Sync applies incoming changes through `crsql_changes`, bypassing them, which is required — bundles arrive per table in no guaranteed order, so a peer's transaction can legitimately land before the sheet it names. **The orphan sweep is report-only** (`findOrphans`, logged at window open via `WindowContext.reportOrphans`): deleting an orphan is a CRDT delete that propagates to every peer, so sweeping a row whose parent merely hasn't arrived yet would destroy good data everywhere. New `referential-integrity.test.ts` (16 cases). tsc clean, 335/335 tests green.
- [x] Phase 6g — Test backfill: balance, forecast, report-analysis, undo, repos. Added `forecast.test.ts` (19, fake timers — every function reads the clock), `report-analysis.test.ts` (19), `undo-store.test.ts` (11, the stack semantics; the command factories in `services/undo.ts` are thin wrappers over `window.api` and need mocks for little return), `invoice-repo.test.ts` (11), `planned-repo.test.ts` (10), `small-repos.test.ts` (15 — category, activity-notes, attachment). Also added `vitest.config.ts`: vitest had been running on bare defaults with **no `@/` alias**, so any renderer module importing through it was untestable. **Found and fixed a live bug**: `InvoiceRepo.updateLinkedFromPlanned` assumed `line_items` was a bare array and threw `items.reduce is not a function` on the `{ items, taxRate, accentMode }` form the app actually writes — editing a planned template with a linked invoice failed outright. It now reads both shapes, preserves the wrapper, applies `taxRate`, and totals in pence. Two behaviours documented by test rather than changed: monthly templates starting on the 29th–31st drift permanently (JS rolls "31 February" to 3 March and never recovers), and `getComparisonPeriod` steps back by exact length, so a calendar month compares against a window spanning two months — its doc comment claimed otherwise and was corrected. tsc clean, 421/421 tests green.

### Sync — Local Sync (phases 0–8 complete)

- [x] Core implementation: cr-sqlite CRRs, device identity, bundle format, merge gate, transport, orchestrator, IPC, UI, compaction, hardening
- [x] Join Local Sync — `joinLocalSync` in migration.ts + JoinLocalSyncDialog. (The Cloud → Local Sync migration path was removed with Cloud Connect.)
- [x] Local Sync auth — Fidra-native identity + authorization via `personnel` table. Device→personnel mapping, role-based UI gating for destructive actions (snapshots, passphrase, disconnect), audit trail attribution. No external auth provider.
- [x] Local Sync auth session persistence — encrypted via safeStorage + sign-out mechanism in sidebar and settings

### Data safety
- [x] Backup & restore (manual backup, history table, folder picker, retention, auto-backup)

### Security
- [ ] Sandbox mode evaluation (`webPreferences.sandbox: true` — test compatibility with better-sqlite3)
- [x] Dependency audit — bumped: picomatch 2.3.2, lodash 4.18.1, flatted 3.4.2, brace-expansion (1.1.14/2.1.0), @xmldom/xmldom 0.8.13, electron 41.2.1, drizzle-orm 0.45.2, drizzle-kit 0.31.10. Remaining: tar/tmp/esbuild/@tootallnate are build-time-only transitive deps (not shipped in app binary), no runtime risk.
- [x] Credential scrubbing in logs — moot since Cloud Connect removal; the Postgres pool error handlers that could leak connection strings are gone

### Code quality
- [x] Standardise undo participation — some domains bypass `execute()`, some operations have no undo
- [x] Reduce duplicated view patterns — sheet-filtering, data-loading, undo/redo buttons, zoom controls
- [x] Improve consistency across table-like views — keyboard nav, multi-select, context menus

### Shipping
- [ ] Electron packaging and distribution (icons, code signing, notarization, build metadata)

### Polish
- [x] Sheet switch transition (brief fade or card-flip when changing sheets)
- [x] Drag-drop attachment pulse — DropZone pulses when files dragged anywhere in window, success flash on drop, "Drop to attach" hover state
- [x] If there is success in creating an account on local sync after using invite code, sign me in immediately
- [x] Show forecasts in the activity view table
- [x] Change the design of the bars on the activity tracker: currently whole month/multi-month events texture should instead reflect texture of active events, and there should be a new texture, a thin line with dashes coming obliquely off periodically as a new design for the multi-month/whole month bar
- [x] Pressing cmd/cntrl (windows) and arrow key should inhibit the table arrow scroll function in the meantime
- [x] Add an x to clear the search bar
- [x] Allow managing local sync personnel from card in settings
- [x] Improve local sync UI (buttons are significant and can cause issues if hit accidentally)
- [x] Fix personnel status badge (Local Sync users showed "Invited" instead of "Active")
- [x] Local Sync change notifications (toasts, OS notifications, "while you were away" dialog)
- [x] Reports page UX rework — fix empty-comparison bug (everything marked "New"), make comparison optional (default: none), add plain-English insights panel, consistent table styling with sortable columns and alternating rows, breakdowns start collapsed
- [x] Reports page redesign — Financial Health card (current/available balance, period net, health status), What Changed + Key Facts two-column panel, Activity Performance always-visible table, Explore section with collapsible Category/Description/Party breakdowns. Removed avgTransactionSize. Transfer-aware reporting (linked_id excluded from totals).

### Features — priority
- [x] Bank reconciliation — import bank CSV (flexible column detection), auto-match against existing transactions by date+amount+description with confidence scoring, support many-to-one matching (one bank row = multiple Fidra rows), UI to review matched/ambiguous/unmatched rows. Implemented as part of CSV import (duplicate detector with exact/content/fuzzy matching layers).
- [x] CSV import with learnable patterns — import bare bank CSV as new transactions, pattern table learns from user history (bank description → Fidra category/party/description), unknown merchants start uncategorized and are remembered once assigned, reconcile against existing to avoid duplicates

## Future Considerations

Don't close these doors:

- **Web version**: Renderer is a pure React/Vite app with zero Electron imports. Web deployment would need: backend server for IPC channels, Postgres instead of SQLite, non-Electron PDF export. Rule: keep Electron-specific logic in `src/main/` and `src/preload/` only.

## Reference Source

The original Python app at `../Fidra/fidra/` is the specification for feature behaviour. Cross-reference when porting features or resolving ambiguous requirements.
