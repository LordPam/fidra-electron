# Installation, invitations, and personal AI access

Assessment: 2026-10-24. Runtime implementation is now present. The findings below describe the pre-change state; current behavior, boundaries and remaining platform/client acceptance checks are recorded in [SETUP_AND_AI.md](SETUP_AND_AI.md).

## Owner decisions

- Latest clarification (2026-10-24): the primary flow is a direct desktop extension. The user attaches a statement in ChatGPT and asks it to reconcile and add missing entries. An explicitly add-enabled scoped connection may apply from the conversation; ambiguity questions stay in chat. Native per-batch approval is the draft-only/fallback route, not a requirement for all imports. This supersedes the original always-native-approval design below.

- Financial files and attachments survive removal by default. Provide a separate device reset.
- An external AI may receive only the bank statements and ledger context the user explicitly selects. This is separate from Local Sync, whose transport remains encrypted and serverless.
- The assistant works in the user's ChatGPT or Claude conversation, rather than an embedded Fidra chat.
- Ask about ambiguity rather than guessing below a suitable confidence threshold.
- Publisher signing is explicitly deferred (owner clarification 2026-10-24). Support distribution without Apple Developer ID/notarization or Windows publisher certificates. Keep the existing macOS ad-hoc build signature and Fidra release-update verification. Explain OS approval steps honestly; managed-device policy can still block execution.
- Desktop apps first: ChatGPT or Claude runs on the same computer as Fidra, with Fidra open and unlocked for connection access. Browser/mobile access is deferred. Provider connection packaging must be proven before promising a frictionless install.

## 1. Installation and removal

### Current findings

- The default operational ledger is `app.getPath('userData')/fidra.db` (`src/main/index.ts`). That directory also contains disposable Electron/update state. Deleting the directory wholesale would delete financial data.
- `~/.fidra` mixes settings, the first-run sentinel, saved sessions, logs, and financial attachment directories. Developer release-signing credentials also currently live under that tree. It is not a safe recursive cleanup target.
- Attachments live separately from the ledger, under `~/.fidra/attachments/<databaseId>/`; backup defaults are beside the ledger, with optional user-selected locations. Keeping only a `.fdra` file is insufficient to preserve all financial files.
- Saved sessions use Electron secure storage when available but can fall back to plaintext JSON (`src/main/services/session-store.ts`). Local Sync also stores a device-scoped passphrase in the ledger settings (`src/main/sync/migration.ts`). Reset/sign-out needs an explicit credential inventory, not just deletion of session files.
- Windows uses a per-user Squirrel installer; its current startup helper removes shortcuts on uninstall but has no Fidra-specific cleanup. macOS distribution is a `.app` in a DMG. There is no device-reset service or uninstall helper.
- Startup currently marks the initial window complete before `app:getStartupMode` can choose the first-run wizard (`src/main/index.ts`, `src/main/ipc/window.ts`). The initial path can therefore bypass setup and create an implicit default ledger. Fix startup deliberately, including the existing empty-dashboard E2E expectations.
- Current macOS signing is ad hoc. Installer-update signatures do not replace platform publisher signing/notarization.

### Intended experience on macOS and Windows

| Action | Expected result |
| --- | --- |
| First install | One normal OS installer, then “Start a ledger”, “Open a ledger”, or “Join a team”. Use a sensible local location; location selection is optional. No terminal, runtime installation, or unexplained empty database. |
| Ordinary uninstall | Remove the program, shortcuts, and Fidra-owned running helpers/registrations through the supported uninstall route. Preserve ledgers, attachments, and backups. |
| Reset this device | Explain the retained financial files, close all windows safely, stop sync/AI helpers, revoke local connection grants, clear credentials and disposable preferences/cache, then return to setup. Preserve financial files and organisation membership. |
| Reinstall | Offer to continue with retained accounts or start fresh. Never interpret stale preferences or a missing last-opened file as a reason to silently create a replacement ledger. |

On macOS, dragging an app to Trash does not execute Fidra cleanup code. Supply a discoverable “Uninstall Fidra” helper/action for the complete supported removal flow; do not promise that arbitrary deletion of the executable runs cleanup. Avoid a persistent watcher solely to detect app deletion. Windows uninstall events and the macOS helper should call the same idempotent cleanup service.

### Implementation requirements

1. Define an owned-path manifest with explicit categories: executable/registrations, disposable device state, credentials, financial documents/attachments/backups, and developer-owned files. Canonicalize paths and reject symlink/path tricks before deletion. Never recursively delete a broad home/app-data directory.
2. Establish a durable, discoverable financial-data location outside disposable caches. Migrate existing default ledgers/attachments only with verified copies and recoverable path updates. Preserve existing user-selected locations. A portable backup/export must contain the ledger and attachments, with a verified manifest.
3. Implement a process-wide lifecycle coordinator. Prepare unfinished forms, close database connections/checkpoint safely, stop sync and AI access, and prevent another Fidra process reopening files during reset. Reuse update preparation where appropriate.
4. Reset must clear known device authentication material, including per-database cached secrets where required, without converting a Local Sync file to standalone or issuing CRDT deletes. Preserve the CRDT identity/history of a retained file. A newly joined database gets a fresh identity. Removing a device is not removing a personnel record or revoking the whole organisation's shared-folder access.
5. Do not persist credentials as plaintext when secure storage is unavailable; use an explicit sign-in-on-launch fallback. A reset cannot erase credentials in unknown user-created copies/backups, so report its scope honestly.
6. Preserve all shared OneDrive data and developer signing keys. No cleanup step should mutate the shared ledger or erase other devices' data.
7. Support unsigned distribution as the current target. Check real first-launch behaviour and document per-app OS approval on macOS/Windows. Publisher signing/notarization is deferred, not a gate for setup, reset, invitations or AI access. Fidra update verification remains enabled.

Acceptance: fresh OS user install; normal remove/reinstall; reset/reinstall; retained ledger with attachments; chosen external backup folder; missing/moved ledger; multiple windows; interrupted reset; failed migration; unreadable preferences; unavailable secure storage. Run on real macOS and Windows installations. Ordinary removal and reset must create no remote deletions.

## 2. Invitations

### Current findings

- The newcomer supplies a shared-folder location, email, code, password, and local database filename (`JoinLocalSyncDialog.tsx`). The admin mainly receives a code to copy.
- Invitations are encrypted token files in the shared folder, keyed by email; joining separately requires a snapshot. Token creation does not ensure a bootstrap snapshot is ready.
- Invitation-token write failures are logged as non-fatal while the admin still receives success (`src/main/ipc/local-auth.ts`). Password-setting failure after join is also logged while the caller receives success and the invitation token is deleted (`src/main/ipc/local-sync.ts`).
- `joinLocalSync` opens the requested destination directly, and failure cleanup unlinks it. Require exclusive creation of a genuinely new destination before any join work; never open, overwrite, or delete a pre-existing destination (`src/main/sync/migration.ts`).
- Token removal after success is best-effort shared-file deletion. It is not a globally coordinated, guaranteed single-use claim. There is no explicit expiry/reissue state.

### Proposed flow

1. Admin selects “Invite”, enters the person and role, then receives a ready-to-share invitation only after the personnel change, token, and bootstrap data have been successfully staged. Provide retry/reissue when preparation fails.
2. Recipient accepts the institution's OneDrive share if needed and opens a `.fidra-invite` file. Fidra validates the invitation and displays the team and person. An invitation opened from the synced folder may supply its containing location; one downloaded elsewhere asks for the folder once. Never embed the sender's absolute folder path as the recipient's location.
3. Recipient chooses a password; Fidra creates a safe local ledger automatically. Keep location changes under an optional control.
4. Fidra waits for missing OneDrive files with a resumable, cancellable progress screen, imports and validates the account, establishes usable authentication, then opens the ledger. No instruction to manually create a snapshot.

Keep “Sign in on another device” separate from “Invite a new person”. Reinstalling or adding a computer must reuse the existing personnel identity instead of creating another member or replacing their password through an invitation.

Invitation format should include a version, group identity, recipient, role, invitation identity, and authenticated metadata. A file can carry a high-entropy capability without asking people to type it. Do not put the shared passphrase in a URL or log. Design expiry, reissue, and claim records with explicit offline limitations: shared-folder deletion cannot instantly revoke secrets already received, and group-key revocation requires a separate key/access policy. An invitation does not grant OneDrive permissions by itself.

Join must be staged and recoverable. Publish the finished local file only after data and personnel/password validation succeeds. Cleanup removes only artifacts this attempt created. Session persistence failure may require an explicit sign-in but must not strand a successfully created account. Clean partial attachment imports as well as database sidecars. Consume the invitation only after success; reconcile claims across peers without claiming perfect offline single-use enforcement.

Acceptance: brand-new team without prior snapshot; slow/paused OneDrive; placeholder files; invitation outside shared folder; wrong team/folder; existing destination; interrupted join; password failure; expired/reissued invitation; retry/double-open; returning member; two devices receiving stale token copies.

## 3. Personal AI connection

### Product boundary

Expose narrow reconciliation tools through MCP, a protocol supported by AI clients. The user talks to their own AI. Fidra owns permissions, validation, approval, and mutation. Do not expose raw SQLite, arbitrary filesystem access, unrestricted transaction editing/deletion, authentication secrets, or sync keys.

Proposed user journey:

1. In Fidra, connect the AI and explicitly select the ledger, sheets/accounts, date range, and context fields it may read. Statement sharing is separately selected. Show what will leave the device and let the user disconnect at any time.
2. In ChatGPT/Claude, ask to reconcile a selected statement. The AI obtains only permitted historical conventions and planned occurrences, then prepares proposed transactions.
3. Ask concise questions about uncertain dates/amounts, ambiguous duplicates, activities, parties, categories, transfers, and planned matches. Group repeated merchant decisions. Show evidence and alternatives; do not replace uncertainty with an arbitrary model-reported percentage.
4. Present one reviewable batch: already present, new, matched planned occurrences, and unresolved items. The user approves the exact batch in Fidra; the AI cannot approve its own proposal. This small review/connection surface does not require an embedded chat.
5. Fidra rechecks the current ledger and applies the valid batch atomically, records the source and audit history, and provides a safe batch undo path.

Selected tool results still reach the external model provider even when the connector runs locally. Local execution does not make cloud inference local. Grants must enforce the user's selection in code, not rely on the assistant following instructions. Bank statement text and other retrieved content are untrusted data, never authority to request new capabilities.

### Reconciliation service before the connector

Current CSV services are useful foundations, not a safe external write API:

- `csv-import.ts` loads transactions across all sheets, assigns `activity: null`, and does not match planned occurrences. Its commit function can substitute today's date/zero/default direction for missing preview values and creates new IDs without a final duplicate/version recheck.
- `csv-duplicate-detector.ts` keys matches by date/amount/description without account/sheet or income/expense direction. Fixed confidence scores are heuristics, not calibrated probabilities. Two legitimate equal charges must not be silently merged.

Build a shared, typed main-process service used by both the normal importer and MCP:

- Explicit database and bank-account/sheet mapping on every operation; stable scope and actor identities independent of the focused window. External calls use the same domain/permission rules as IPC, not fake Electron events or a second direct-write database path.
- Strict real dates and integer-pence amounts, direction, statement-row evidence, source references, and statement totals where available. Missing or contradictory financial fields block approval rather than defaulting silently. Retain raw bank descriptions alongside proposed normalised descriptions.
- Candidate duplicates consider bank transaction IDs when present, source evidence, account, direction, dates, amount, and repeated rows within the statement. Retrying the same approved proposal must be idempotent. A content hash/date/amount alone is not proof of identity.
- Suggest categories, parties, descriptions, and activities using permitted historical examples and confirmed rules. Ask when candidates compete. Learn a mapping only after explicit confirmation and within its intended scope.
- Distinguish an existing actual transaction from a forecast occurrence. Existing actuals are linked/skipped appropriately; a planned match creates the actual and fulfils that exact occurrence in one transaction. Handle recurring, skipped/already fulfilled occurrences, amount/date differences, transfers and invoice links. Never fulfil an entire recurring template for one payment.
- Drafts remain local and do not sync as ledger rows. Store a proposal identity, exact content digest, referenced row/template versions, decisions, and source evidence. User approval binds that exact version, not a later AI replacement.
- Before commit, enforce permissions and grant validity again, recompute duplicate/planned checks against current rows, and reject/review stale proposals. Commit actuals, occurrence changes, import provenance, and audit entries atomically. Audit learning failures must not cause a retry to duplicate the batch.
- Batch undo follows the existing command contract, using a shared mutation journal/service rather than reaching into a renderer store from MCP. Check later edits before compensating; do not blindly remove a transaction another member has edited.
- A local idempotency key does not prevent two disconnected peers importing the same statement. Design synced import provenance and duplicate-conflict review, and test that case explicitly. Do not promise global exactly-once import without a coordination mechanism.

Start with tools for permitted ledger discovery, bounded reconciliation context, statement analysis, proposal staging/questions, and proposal status. Connection grants are revocable, limited by ledger/sheet/operation, and cannot exceed the user's existing role. Require Fidra to be open and unlocked initially. Closing/resetting/uninstalling Fidra stops or disconnects its bridge. Any later remote transport needs authenticated scoped access, origin/request validation, expiry, and rate/size limits.

### Provider connection feasibility, checked 2026-10-24

- Claude Desktop supports packaged local MCP extensions. A bundled `.mcpb` is a plausible install flow on both desktop platforms without user runtime setup. [Anthropic's desktop extension documentation](https://www.anthropic.com/research/desktop-extensions).
- ChatGPT documents desktop-only local MCP plugins, but local MCP submissions currently require approved-partner allowlisting. Do not assume Fidra can distribute one immediately. [OpenAI desktop-only plugin requirements](https://developers.openai.com/plugins/deploy/desktop-only).
- OpenAI's outbound MCP tunnel is an option for private connections/testing, subject to account/workspace permissions and runtime credentials. It is not the public plugin-distribution route. [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).
- Browser/mobile support changes transport and availability: a local process must be running and reachable through a supported authenticated route. Prove the user's actual ChatGPT surface and eligibility before choosing a public relay or promising one-click setup. A relay would be an explicit new service/processing decision, not part of existing Local Sync.
- A structured proposal file can serve as a compatible interim/fallback exchange in either AI, with the same evidence, scope, validation, and approval checks. It is less seamless than live MCP and does not replace the requested connection target.

## Delivery order

1. Lifecycle/storage inventory, portable financial-file preservation, correct first-run startup, reset/uninstall/reinstall flows, and platform installation checks.
2. Invitation safety fixes and simplified invitation/open/sign-in flow, with OneDrive-delay recovery.
3. Shared reconciliation proposals, account-aware deduplication, activity/convention suggestions, planned matching, exact approval, atomic commit and undo.
4. Prove read-only and stage-only MCP access in both chosen clients; then package the connection without adding terminal/JSON setup. Public distribution is a separate gate from a successful developer proof.

For phase 3/4, test malicious statement instructions, unauthorised sheet access, revoked grants, repeated calls, changes after preview, partial failure, multiple windows, two offline peers importing the same source, and undo after another person's edit. Keep standalone databases fully functional and Local Sync non-blocking throughout.
