# Fidra-Web

Fidra-Web is a desktop financial ledger app (Electron + React + TypeScript). Originally ported from a Python/PySide6 app at `../Fidra/fidra/`.

## Status

Core product is implemented: 7 views (Transactions, Planned, Activities, Dashboard, Reports, Invoices, Settings), multi-window with per-window SQLite, authentication, attachments, undo/redo, PDF export. The app supports two parallel sync backends — **Cloud Connect** (user-hosted Postgres) and **Local Sync** (OneDrive shared folder) — serving organisations with different infrastructure constraints (see [Sync Backends](#sync-backends)). Active work spans both sync backends, hardening, consistency, bug fixing, and architectural cleanup. See [Backlog](#backlog) for specific items.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (strict mode), no `any` except at system boundaries |
| UI | React 18, Zustand stores, Tailwind CSS 4, shadcn/ui |
| Desktop | Electron + Electron Forge, Vite for renderer |
| Database | better-sqlite3 (main process), Drizzle ORM |
| Sync: Cloud Connect | Supabase/Postgres, LISTEN/NOTIFY realtime, sync queue, optimistic locking |
| Sync: Local Sync | cr-sqlite (CRDTs), chokidar (file watching), AES-256-GCM (bundle encryption) |
| Validation | Zod at all IPC boundaries |
| Charts | Recharts |
| Icons | Lucide React |
| Router | React Router v7 |

## Architecture

### Product Invariants

These are non-negotiable constraints. Every change must preserve them.

1. **Local SQLite is the operational store.** All reads hit local SQLite. Cloud sync is async, non-blocking, and optional. Cloud failure must never block local workflows.
2. **Renderer never does direct DB or file I/O.** All data access goes through typed IPC via `window.api`. No Electron or Node imports in `src/renderer/`.
3. **IPC is the contract.** Channels typed in `src/shared/ipc-types.ts`, inputs validated with Zod in main-process handlers. When IPC types change, both sides update together.
4. **Sheet scoping must be explicit.** Views that filter by sheet should do so visibly. Cross-sheet operations must be intentional.
5. **Undoable operations use command abstractions.** Data mutations should go through `services/undo.ts` command factories and `useUndoStore.execute()`. Direct state mutation for undoable actions is an anti-pattern.
6. **Multi-window correctness is first-class.** Each BrowserWindow has its own SQLite connection and repo instances via `WindowContext`. IPC handlers resolve per-window context via `resolveContext(event)`.
7. **Sync mode is immutable per database file.** A database file is standalone, Cloud Connect, or Local Sync — never switchable at runtime. Changing sync mode requires a formal migration that creates a new database file and copies data. Cloud Connect (Postgres) lives in `src/main/cloud/`. Local Sync (OneDrive) lives in `src/main/sync/`. Neither depends on the other. Renderer never imports Supabase, Node fs/path, or sync internals.
8. **Critical-field conflicts require manual review.** Local Sync must never silently overwrite amount, date, type, status, sheet, or party on transactions (or equivalent critical fields on other entities). Conflicting changes to these fields are queued for human resolution. Cloud Connect uses optimistic locking with its own conflict dialog.
9. **Local Sync bundles are encrypted and signed.** All data leaving the local machine for the shared OneDrive folder is AES-256-GCM encrypted and HMAC signed. Corrupted or tampered bundles are rejected.

### When Changing Behaviour

- **Prefer shared services/commands over view-local orchestration.** If a view is doing multi-store mutations, that logic belongs in a service.
- **Preserve local-first behavior.** Never make local operations depend on cloud state.
- **Do not bypass typed IPC.** If you need new data access, add a channel.
- **Keep cloud optional.** Features must work without a cloud connection.
- **Treat multi-window as a constraint, not an afterthought.** State that looks global might be per-window.
- **Prefer explicit domain rules over implicit UI-state rules.** If a business rule is embedded in a `useMemo` or view state, consider extracting it to a domain function.

### Key Patterns

| Pattern | Location |
|---------|----------|
| Per-window context | `WindowContext` in `src/main/window/window-context.ts`, resolved via `resolveContext(event)` in `src/main/ipc/context-resolver.ts` |
| Repository layer | Class-based repos in `src/main/repositories/`, caching wrappers in `src/main/cloud/caching-repos.ts` |
| Undo commands | Factory functions in `src/renderer/services/undo.ts`, executed via `useUndoStore.execute(command)` |
| Cloud Connect sync | `SyncQueue` (local→cloud), `ChangeListener` (cloud→local via LISTEN/NOTIFY + polling fallback), `CachingRepos` (local + Postgres wrapper) |
| Local Sync | cr-sqlite CRRs + merge gate (merge engine), encrypted bundles via shared folder (transport), chokidar + polling (detection) |
| Error boundaries | Every view wrapped in `<ErrorBoundary>` in `App.tsx` |
| Global settings | `~/.fidra/settings.json` for cross-database prefs (theme, recent files) |
| Per-db settings | SQLite `settings` table for database-specific config (profile, FY month, tx behavior) |

### Directory Structure

```
src/
├── main/              # Electron main process
│   ├── database/      # SQLite + Drizzle (connection.ts, schema.ts, settings-repo.ts)
│   ├── ipc/           # IPC handlers, one per domain + context-resolver.ts
│   ├── repositories/  # Local SQLite repos (class-based, injected Database)
│   ├── cloud/         # Cloud Connect: Postgres sync, repos, auth, caching layer, SyncQueue
│   ├── sync/          # Local Sync: cr-sqlite CRRs, merge gate, bundle transport, conflict queue
│   ├── window/        # WindowManager, WindowContext, global-settings
│   ├── menu/          # Native menu bar
│   └── services/      # Main-process services (attachments, audit)
├── renderer/          # React app (Vite-built)
│   ├── domain/        # TypeScript types, Zod schemas
│   ├── stores/        # Zustand stores (one per domain slice)
│   ├── services/      # Renderer-side logic (search, balance, forecast, undo, export)
│   ├── views/         # 7 top-level view components
│   ├── components/    # Reusable UI (TransactionTable, SearchBar, AttachmentPanel, etc.)
│   ├── dialogs/       # 14 modal dialog components
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
- **Tests**: Vitest for unit/integration, Playwright for E2E
- **TypeScript**: `npx tsc --noEmit` must pass after every refactor

## Key Domain Models

- **Transaction**: id, date, description, amount, type (INCOME|EXPENSE), status (AUTO|PENDING|APPROVED|REJECTED|PLANNED), sheet, category, party, reference, activity, notes, version, timestamps
- **PlannedTemplate**: id, start_date, description, amount, type, target_sheet, frequency (ONCE|WEEKLY|BIWEEKLY|MONTHLY|QUARTERLY|YEARLY), end_date/occurrence_count, skipped_dates, fulfilled_dates
- **Sheet**: id, name, is_virtual, is_planned
- **Category**: id, name, type, color
- **Attachment**: id, transaction_id, filename, stored_name, mime_type, file_size
- **Invoice**: id, invoice_number, date, due_date, status, party, items, subtotal, tax, total, notes, timestamps
- **AuditEntry**: id, timestamp, action, entity_type, entity_id, user, summary, details

## Sync Backends

Fidra supports two parallel sync backends. Each database file is permanently one mode — standalone, Cloud Connect, or Local Sync. Switching requires a formal migration that creates a new database file. Both backends are optional — the app works fully offline with no sync.

**Sync mode immutability:** A database file's sync mode is set at creation time and never changes. This avoids dangerous edge cases: CRR initialization on existing Cloud data produces `col_version=1` rows that silently conflict with established Local Sync version histories. Migration creates a clean file with proper initialization from the start. Runtime guards in settings UI prevent the user from configuring the wrong sync backend on an existing file. Temporary runtime guards (`syncFolderHasExistingPeers`, mutual exclusion checks in `localSync:configure` and `cloud:connect`) enforce this until the migration flow is built — they can be simplified once migration is the only path.

### Cloud Connect (Postgres) — for autonomous organisations

Flagship sync for organisations that can host or provision their own Postgres server (e.g., via Supabase). Provides real-time sync via LISTEN/NOTIFY, optimistic locking, auth (owner/member roles), and attachment storage.

**Status:** Implemented and production-ready. Ongoing hardening (see Known Weak Spots).

**Architecture:** `SyncQueue` (outbound) + `ChangeListener` (inbound via LISTEN/NOTIFY + polling fallback) + `CachingRepos` (local SQLite + Postgres wrappers). Conflict resolution via optimistic locking — version mismatch triggers `ConflictDialog`.

**Code:** `src/main/cloud/`

### Local Sync (OneDrive) — for constrained organisations

File-based peer-to-peer sync for organisations that cannot give data to third-party services (e.g., university clubs on institutional OneDrive). Uses a shared OneDrive folder as a dumb mailbox — no server, no accounts, no third-party data processing.

**Status:** In development. Full design in `memory/sync-architecture.md`.

**Architecture:** cr-sqlite CRRs (merge engine) + pre-merge gate (critical-field conflict detection → manual review queue) + encrypted bundle transport via shared folder + chokidar file watching + polling fallback.

**Code:** `src/main/sync/` (new)

**Key decisions:**
- cr-sqlite as merge engine (CRDTs, version vectors, causal ordering)
- Pre-merge gate: critical-field conflicts → manual review queue, everything else → auto-merge via cr-sqlite
- Bundles are gzipped JSON, AES-256-GCM encrypted, HMAC signed
- Compaction via high-water marks + snapshots for new-device onboarding
- **Full org-wide sync**: Local Sync is a complete alternative to Cloud Connect, not a subset. All org-relevant data syncs.

**Synced tables (CRRs):**
- `transactions`, `planned_templates`, `sheets`, `categories`, `invoices`, `activity_notes` — core ledger data
- `personnel` — requires new local SQLite table (currently Postgres-only in Cloud Connect)
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

**Implementation phases:**
0. Spike: cr-sqlite + better-sqlite3 in Electron (GATE — must pass before proceeding)
1. Foundation: device identity + bundle format
2. Merge gate: critical field conflict detection
3. Transport: shared folder read/write
4. Sync orchestrator: end-to-end integration
5. IPC and renderer integration
6. UI: setup dialog, activity feed, conflict review
7. Compaction, snapshots, onboarding
8. Hardening

## Current Priorities

Work in this order when choosing what to improve:

1. ~~**Eliminate domain logic from views.**~~ Done. ActivitiesView domain logic extracted to `services/activity.ts` and `services/activity-aggregation.ts`. View now only contains UI orchestration (selection, animation, keyboard nav, chart shaping).
2. **Standardise undo participation.** Some domains bypass `execute()` and mutate `useUndoStore` directly. Some operations (settings, invoice builder state) have no undo at all.
3. ~~**Harden startup/auth/session restoration.**~~ Done. Single entry point `auth-store.initialize()` handles hydration with `isHydrated` state machine. `useAuthGate` reads from auth-store instead of calling IPC directly. Event listeners registered synchronously before async IPC to close race window.
4. **Reduce duplicated view patterns.** Sheet-filtering useMemo, data-loading useEffect, undo/redo header buttons, zoom controls — all copy-pasted across 3-5 views.
5. **Improve consistency across table-like views.** TransactionTable has full keyboard nav, multi-select, context menus, animations. Planned and Activities have partial or ad hoc implementations. No shared interaction contract.
6. **Fix settings persistence boundaries.** Four modes (SQLite, global JSON, localStorage, cloud) with unclear ownership. Invoice builder state in localStorage is fragile and unsynced.
7. **Prefer explicit domain rules over implicit UI-state rules.** Activity status inference, invoice number generation, and activity date parsing are embedded in views, not domain functions.
8. ~~**Fix fragile Electron-specific behaviours.**~~ Done. DropZone now uses `webUtils.getPathForFile()` exposed via preload contextBridge instead of deprecated `File.path`.

## Known Weak Spots

Consult `memory/architecture-audit.md` for detailed analysis with file:line references.

- ~~**Activities workflow is view-heavy**~~: Done — domain logic extracted to `services/activity.ts` + `services/activity-aggregation.ts`
- ~~**Auth restoration has edge cases**~~: Done — single `auth-store.initialize()` entry point with `isHydrated` state machine; `useAuthGate` reads store instead of IPC; event listeners registered before async work
- ~~**Drag-drop attachments are fragile**~~: Fixed — uses `webUtils.getPathForFile()` via preload; pulse animation on drag-over; success flash on attach
- **Undo coverage is incomplete**: Settings changes, invoice builder edits have no undo; AttachmentPanel and ActivitiesView bypass `execute()` and push directly to undo store state
- **Settings/identity ownership is uneven**: Profile is per-db but semantically per-user in cloud mode; FY month exists in three places (SQLite, global JSON, Postgres); invoice builder state in localStorage
- **Invoices are global but depend on sheet-scoped operations**: InvoicesView doesn't filter by sheet, but mark-as-paid creates sheet-scoped transactions with sheet-derived defaults
- **silentRefresh / cloud sync race**: After undo-delete, `refreshFromCloud` can re-write the transaction to local SQLite before the cloud delete syncs upstream. `recentlyDeleted` TTL map mitigates for 5 seconds but doesn't fully prevent resurrection.

## Backlog

### Sync — active work

Both sync backends are functional. Remaining work is hardening, auth, and the final migration path.

**Local Sync (Phases 0–8 complete)**
- [x] Core implementation: cr-sqlite CRRs, device identity, bundle format, merge gate, transport, orchestrator, IPC, UI, compaction, hardening
- [x] Sync migration: "Join Local Sync" + "Migrate Cloud → Local Sync" (migration.ts, JoinLocalSyncDialog, MigrateToLocalSyncDialog)
- [x] Local Sync auth — Fidra-native identity + authorization via `personnel` table. Device→personnel mapping, role-based UI gating for destructive actions (snapshots, passphrase, disconnect), audit trail attribution. No external auth provider.
- [x] Local Sync auth session persistence — encrypted via safeStorage + sign-out mechanism in sidebar and settings

**Cloud Connect**
- [ ] silentRefresh zombie resurrection edge cases beyond RecentDeletes TTL
- [ ] Member mode connection state improvements

**Cross-backend**
- [ ] Migrate Local Sync → Cloud Connect — settings action on Local Sync DB, push data to Postgres, switch window. Last migration path; once built, simplify runtime mutual-exclusion guards.

### Data safety
- [x] Backup & restore (manual backup, history table, folder picker, retention, auto-backup)

### Security
- [ ] Sandbox mode evaluation (`webPreferences.sandbox: true` — test compatibility with better-sqlite3)
- [x] Dependency audit — bumped: picomatch 2.3.2, lodash 4.18.1, flatted 3.4.2, brace-expansion (1.1.14/2.1.0), @xmldom/xmldom 0.8.13, electron 41.2.1, drizzle-orm 0.45.2, drizzle-kit 0.31.10. Remaining: tar/tmp/esbuild/@tootallnate are build-time-only transitive deps (not shipped in app binary), no runtime risk.
- [x] Credential scrubbing in logs (pool error handlers may leak connection strings)

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

## Future Considerations

Don't close these doors:

- **Web version**: Renderer is a pure React/Vite app with zero Electron imports. Web deployment would need: backend server for IPC channels, Postgres instead of SQLite, non-Electron PDF export. Rule: keep Electron-specific logic in `src/main/` and `src/preload/` only.

## Reference Source

The original Python app at `../Fidra/fidra/` is the specification for feature behaviour. Cross-reference when porting features or resolving ambiguous requirements.
