# External-app ledger operations

Status: implementation in progress, 26 October 2026. The owner confirmed that settings, backups, sync and team administration belong in scope alongside ledger operations. Passwords and AI-access approval stay in native Fidra. The source now includes scoped domain reads, backup creation and existing sync controls. These changes are not installed or published; existing live permissions have not changed. The owner requires the same limits and controls as a human using Fidra.

## Required boundary

An external app requests a named Fidra operation. Fidra authenticates the installation, resolves the approved ledger and current user/standalone owner, checks authority and consent, validates the request, and executes the same application operation used by the desktop UI. Repositories and SQLite remain implementation details inside Fidra. No external SQL, database paths, table/column updates, generic IPC invocation, arbitrary code, or arbitrary file access.

Effective authority is the intersection of the current user's authority, the connection's approved capabilities and resource scope, and the operation's current domain rules. A connection must never have more authority than its user. Capability discovery is helpful presentation; enforcement on every operation is mandatory. Model instructions, tool annotations and hidden UI buttons are not authorization.

“Same controls” means shared business rules, permission checks, confirmations, linked effects, validation and Undo semantics. It does not require simulated mouse clicks. Neither a renderer command nor an MCP handler should provide an alternative route around those controls.

## Current implementation: verified facts and limits

- `AiAccessBroker` verifies challenge-signed installation identity and durable native consent, binds it to a canonical ledger/database identity and approving identity, and rechecks current authority on calls. Team approval currently requires a signed-in admin; a standalone ledger uses its configured, unlocked AI-access owner. This is narrower than general UI access, not a complete user-capability model.
- The external adapter has no database interface. `AiBridge` exposes selected reconciliation context, chat statement registration, proposals and optional append/fulfil operations. `allowAdd` does not authorize editing/deleting actuals, sheet management or the other requested features.
- `ReconciliationService` is Fidra-owned main-process code using its repositories, not the renderer's general command path. It enforces account/date scope, source evidence, duplicate/planned checks, immutable proposal digests and guarded atomic application. `AiBridge` backs up before apply and rechecks authorization afterwards; `ai-runtime.ts` and `AiProposalNotice.tsx` notify windows and record native Undo.
- General UI mutations enter through typed IPC with Zod validation, but additional workflow behavior is split between main IPC handlers, renderer services and Undo factories. `resolveContext` selects the window; it is not itself a role guard. The six ledger-domain IPC modules now delegate to shared, guarded application services; settings, backup and basic sync controls use shared services as well. Higher-level invoice, planned fulfilment and destructive cross-resource workflows still need consolidation before general external writes are exposed.
- Examples to consolidate: planned saves update linked invoices; sheet rename/merge/delete cascade through named references; transaction deletion includes transfer counterparts and attachment trash; activity rename/delete spans actuals, plans and notes; invoice marking paid links a transaction. Transfer creation and editing now save both halves atomically. Activity rename/delete now use a single typed, atomic application change, with version/note checks and native Undo/Redo. These workflows must not be approximated by a series of loosely related external row writes.

## Coverage requested

| Domain | Application operations | Required shared effects |
| --- | --- | --- |
| Actual transactions | List/read, create, edit, duplicate, delete, existing status actions and supported bulk actions | Money/date/status rules, current versions, linked transfers, attachments, audit and Undo |
| Planned transactions | List/read, create/edit/end/delete schedules, skip/restore/fulfil exact occurrences, supported planned transfers | Recurrence rules, fulfilment bookkeeping, invoice linkage and atomic actual creation |
| Internal transfers | Record/edit/remove a ledger transfer | Both permitted accounts, one linked pair, equal amounts/opposite directions, atomic save and Undo; never initiates a bank payment |
| Sheets/accounts | List/create/rename/reorder/merge/delete | Explicit resource scope, cascade preview, all referenced plans including transfer destinations, attachments and complete Undo |
| Categories | List and the current create/rename/remove/reorder workflows | Ledger-wide consequences and explicit ledger-wide consent; do not infer permission from one selected account |
| Activities | Current grouping, rename/remove/assignment and notes workflows | Activities are labels across transactions/plans plus notes, not an independent activity table; preserve current semantics and scope every affected record |
| Invoices | List/read, build/edit, current lifecycle actions, linked planned/actual workflows, supported export | Numbering, money/tax totals, linked schedules/receipts and atomic lifecycle transitions; invoice scope must be explicit because invoices are not directly sheet-owned |

The owner confirmed administration coverage as well:

| Domain | Application operations | Required shared effects |
| --- | --- | --- |
| Settings | Supported profile, appearance, transaction behavior, financial year, organisation and invoice-default reads/updates | Same per-user/device/ledger ownership as the desktop; explicit operation-specific schemas instead of arbitrary setting keys; organisation-name edits retain their admin restriction in a team |
| Backups | List/create, settings, restore and delete through existing controls | Backup identifiers resolved by Fidra within the approved ledger; no caller-supplied arbitrary filesystem paths; restore keeps same-file multi-window checks, sidecar cleanup, sync shutdown, context rebuilding and appropriate native confirmation |
| Sync | Status, supported synchronization/maintenance actions, conflict review, configure/join/disconnect workflows | Local-first and immutable sync-mode rules, current authority, existing native folder/credential selection; never disclose stored passphrases or keys; critical conflicts still require human review |
| Team administration | Personnel reads, role updates/removal, invitations and supported membership workflows | Live actor-role checks, last-admin/self-removal rules, native invitation file selection/sharing; credential-bearing invitation material stays in the relevant native workflow |
| Device/application lifecycle | Existing supported update, reset, uninstall and window preparation workflows | Same native confirmation and unfinished-work protections across all windows; no arbitrary process execution, filesystem access or security-setting escape hatch |

Passwords and AI-access approval remain native-only. An external tool may request that Fidra open the relevant native workflow, but cannot submit credentials or self-authorize connection privileges. Existing critical-field sync conflicts still require human resolution under the product invariants. Broader feature support is not permission to expand existing live grants.

## Implemented foundation

- `application-access.ts` resolves authority from trusted per-window state and the current personnel repository record, rather than a caller-supplied role or the cached sign-in role. It distinguishes ordinary ledger use, ledger administration and team administration, and rejects closed, removed, inactive and signed-out team identities. Standalone UI authority does not substitute for the broker's separate external ownership/grant checks.
- `personnel-administration.ts` contains the shared role-change/removal operations with input validation, current authority, self-removal/last-admin guards and the existing audit events. Desktop personnel IPC delegates to these operations; external dispatch has not yet been wired or granted access.
- Native invitation creation/export and organisation-name writes now use the same live authority check. This closes the cached-admin-role route before broader external administration is introduced. These are source changes, not a deployed app update.
- Desktop IPC now delegates to 61 shared entry points across transactions, schedules, transfers, sheets, categories, invoices, activity notes/assignments, settings, backup controls, basic sync and personnel. This is a shared boundary, not completion of every higher-level workflow.
- Transfer edits use atomic paired save with matching amount/date/account/link validation. Planned saves and bulk saves update linked invoices atomically when date/description/amount actually change; label or note edits preserve custom invoice details. Account operations validate current identity, merge destinations and complete reorder lists; simple undo-deletion refuses populated accounts.
- Activity assignment/note changes use one typed application operation, restricted to those fields. Native activity rename/delete and Undo/Redo use it. All affected versions and expected notes are checked before any mutation; destination notes are protected. Post-commit refresh failures do not discard Undo. The browser demo implements the same field-limited contract.
- Native consent explains that the existing reconciliation context remains the baseline read permission; the new record-read capabilities add full records/versions. It has 26 additional explicit capabilities, each off by default for old approvals, plus a separate opt-in for all current/future accounts and ledger-wide effects. Global operations require that explicit scope. The approval dialog loads accounts read-only on opening, including when Settings is the first mounted view. Passwords and approval remain native.
- The offline and live catalogues now include 19 tools: the original eight plus scoped transaction/plan/invoice/category/activity/settings/personnel/sync/backup reads, `run_sync`, and `create_backup`. They dispatch named operations only. Transaction/plan optional fields are projected, planned transfers require both accounts, invoice fields are projected without arbitrary embedded JSON, and team/settings/backup/sync outputs exclude credentials and local paths. Ledger-wide consent does not replace current role checks.
- Backup creation coalesces concurrent retries and stores a connection-bound request hash in private metadata for retries after restart while the backup is retained. A backup removed by retention can be replaced on a later retry. Externally returned identifiers are opaque. Legacy backups lacking ledger identity remain native-only. Backup administration uses live admin checks in both the shared operation and UI. Restore rechecks current authority and same-file windows after asynchronous safety backup; its target is protected from retention, and the safety backup is retained. Retention never removes another identified ledger’s backups; ambiguous legacy backups require explicit native removal.
- The plugin’s bundled `fidra-ledger` guidance describes implemented reads and controls and explicitly distinguishes the remaining write/admin work. Tool schemas are shared data, allowing offline catalogue generation without loading Electron or a database.
- Verification checkpoint: 663 unit tests across 58 files pass. All 14 real-Electron scenarios are verified against the source builds. The final full rerun passed 13 and one stderr assertion captured a Chromium WidgetHost rejection after its financial assertions passed; that test then passed three consecutive isolated repeats. The harness was not changed to hide that message. All four approval/connection scenarios also passed again after the final wording clarified baseline reconciliation access separately from additional record permissions. Typecheck, changed-file lint (zero errors, one pre-existing non-null-assertion warning in Local Sync), whitespace checks, isolated demo build, final local unsigned packaging and generation of all 19 tool schemas pass. An isolated plugin build contains all three skills and initializes offline with 19 tools and combined ledger/reconciliation guidance, without credentials or ledger access. No live ledger was accessed, installed app/plugin updated, existing approval expanded or public release published.

Remaining: semantic create/edit/delete/fulfil/export workflows, transaction/transfer bulk invariants, invoice lifecycle atomicity, complete sheet-delete linked effects and Undo, common version-bound review/receipt/idempotency machinery for ledger mutations, native review for destructive/admin operations, additional sync/team/device workflows, parity tests, matched version packaging and installation. Do not expose raw row saves, restore endpoints or generic IPC as substitutes.

## Implementation order

### 1. Shared application operations before additional writes

- Inventory each current UI action's inputs, allowed principals, confirmations, affected resources, linked changes, error behavior and Undo behavior. Treat current UI behavior as the starting specification; resolve inconsistencies rather than silently treating an unguarded handler as intended permission.
- Define typed operation inputs/results and a trusted operation context. Resolve principal, ledger and actor attribution inside Fidra. The caller may not supply its own role, authorization, audit identity, timestamps or generated IDs as proof of authority.
- Extract main-process application services behind the existing typed IPC contract. Update the desktop path and external path together to call those services. Move multi-call renderer workflows into atomic application operations where needed. Retain UI command factories for UI state and Undo integration; do not create a second external-only implementation.
- Keep Local Sync's CRDT ingestion separate from user/application mutation guards, as required by the existing architecture. No network or AI availability dependency on local desktop workflows.

### 2. Shared authorization and operation effects

- Centralize authoritative operation permissions for standalone users and team members/admins. Recheck the current identity, current role and current grant before commit and after asynchronous backup/review steps.
- Describe the complete impact before destructive or cross-resource operations. A transfer requires both accounts; a sheet deletion/merge includes affected linked records; a category/activity change may have ledger-wide effects. Reject an operation if any affected resource is outside consent, rather than silently doing a partial operation.
- Preserve the confirmation requirements of the equivalent desktop action. Carry a digest/version-bound review through the shared operation so a lower-level endpoint cannot skip it or apply a stale preview. Consent to use a tool is distinct from confirmation of a particular destructive action.
- Preserve native Undo/Redo for every undoable operation, including linked records and attachments. Do not implement general Undo by restoring an entire database. Reject stale reversals that would overwrite later user/peer edits. Attribute actions to the actual user/owner via the client and notify every affected ledger window after commit.

### 3. Native capability consent

- Replace the two reconciliation toggles with an operation-capability model, with clear native groups for the requested domains, destructive actions and ledger-wide resources.
- Migrate existing approvals without adding authority: old `allowAdd` remains reconciliation append/fulfil only; every new capability defaults off. Existing connections and their account/field restrictions must continue working.
- Keep native approval as the only authority to grant/expand connection scope. The owner/admin chooses additional capabilities. New account creation needs an explicit policy for whether the connection may subsequently use accounts it creates; it must not silently gain access to unrelated accounts.
- Continue requiring explicit `connectionId` when more than one ledger is approved. Do not use focused-window selection or a paused grant as authorization for a different ledger.

### 4. Named external tools and read coverage

- Generate schemas and tool descriptions from the shared operation definitions. Offer domain-level requests such as creating a plan or recording an internal transfer; do not expose raw save-row/restore methods as a general-purpose escape hatch.
- Add scoped read/preview operations so clients can discover real IDs, versions, schedules, invoice state and consequences without obtaining unrelated history or fields.
- Use idempotency keys for mutation retries; bind them to the connection, operation and normalized inputs. A duplicate delivery must not create a second plan, transfer, invoice or deletion. Reusing a key with different inputs must fail.
- Return the completed application result and affected IDs, or an actionable validation/review error. Do not claim a change succeeded when it is only staged or waiting for native confirmation.
- Update bundled skills to explain each supported workflow, uncertainty, external-text injection boundaries and permission failures. Skills describe enforced behavior; they do not grant capabilities.

### 5. Verification and delivery

For each operation, run the same relevant cases through desktop IPC and external entrypoints and compare business effects, errors and Undo. Include denied principals, revoked/paused access, role/password changes, unapproved fields/accounts, linked out-of-scope records, stale previews, retries, partial failures and same-ledger multi-window updates. Use synthetic ledgers for tests.

Run targeted unit/integration checks, TypeScript, relevant lint and real-Electron workflow checks. Exercise a standalone owner and representative team roles. Package the app and plugin together only after the common layer is verified. The Mac's currently pinned local connector also needs a deliberate payload update; changing the account-uploaded plugin alone will not refresh it. Obtain native approval for new capabilities through the normal product flow. No public app/plugin release or live-ledger mutation is authorized merely by this design work.

## Completion criteria

Every requested operation has one authoritative implementation used by both entrypoints; the external app cannot exceed its user or grant, skip a required confirmation, omit linked effects, bypass validation or escape the native audit/Undo model. Existing narrow approvals retain their original authority. A client can successfully perform the requested supported workflows through documented tools after installing the reviewed app/plugin versions and obtaining native capability consent.
