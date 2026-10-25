# Installation, invitations, and personal AI access

Assessment: 2026-10-24. Runtime implementation is now present. The findings below describe the pre-change state; current behavior, boundaries and remaining platform/client acceptance checks are recorded in [SETUP_AND_AI.md](SETUP_AND_AI.md).

## Owner decisions

- Latest clarification (2026-10-25): install from ChatGPT's Plugins tab, approve access once as a Fidra administrator, and retain the installation and approved permissions. Exporting packages/context/proposals and hourly manual reconnection are development/fallback mechanics, not the requested product journey. The current implementation is incomplete against this requirement. See `plan-ai-plugin-product.md` for the superseding design, authorization gaps and OpenAI directory-distribution dependency.

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

The 25 October product clarification and implementation supersede the earlier file-exchange and temporary-grant design. See `plan-ai-plugin-product.md` for the architecture, `SETUP_AND_AI.md` for implemented behavior and outstanding acceptance, and `CHATGPT_SETUP.md` for the intended user journey. Manual exports, context files and repeated connection setup have been removed from the app. The guarded reconciliation service is retained.
