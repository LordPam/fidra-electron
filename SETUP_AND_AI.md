# Setup, device reset and personal AI

Implementation notes and acceptance status, 24 October 2026. These changes are local development work; no release has been published.

## Unsigned installation

Fidra currently has no Apple Developer ID, notarization or Windows publisher certificate. These are not prerequisites for the setup, invitations, device reset or personal AI features. Mac builds retain the existing ad-hoc bundle signature. Update downloads retain Fidra's separate Ed25519 verification; that verification does not establish a publisher identity with the operating system.

- **macOS:** copy Fidra from the DMG to Applications. If macOS cannot verify the developer, attempt to open it, then use the per-app **Open Anyway** option in System Settings → Privacy & Security when available. See [Apple's instructions](https://support.apple.com/en-gb/102445).
- **Windows:** run the per-user Setup.exe. SmartScreen may show an unrecognized-publisher warning and offer **More info → Run anyway**. Every unsigned version may trigger a new warning. See [Microsoft's explanation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).

Managed-device policies or Windows Smart App Control may prevent an override. A warning-free first installation cannot be promised with the current distribution model. Do not disable system-wide security as part of installation.

## First use and retained files

The welcome screen offers **Start a ledger**, **Open a ledger** and **Join a team**. Starting a ledger selects a safe local filename automatically; a custom location remains available through the normal file menu. A missing last-opened file sends the user to file selection rather than silently recreating it.

New default ledgers live under `~/.fidra/accounts/` (`%USERPROFILE%\.fidra\accounts\` on Windows). Existing ledgers keep their locations. Attachments remain in `~/.fidra/attachments/<databaseId>/`. Preserve that directory along with the ledger when moving financial files. Backups remain in their configured locations. The protected `accounts.json` recovery index lets setup offer retained ledgers after a device reset.

In **Settings → This device**:

- **Reset this device** prepares every window, refuses unfinished forms, stops sync and AI access, clears saved sign-ins/preferences/caches, closes database connections and quits. It preserves ledgers, attachments, backups, the recovery index, team membership and shared OneDrive data. Reopen Fidra to choose a retained ledger or start again.
- **Uninstall Fidra** performs that cleanup and removes the installed app using the supported platform route. It is available only in an installed build. On macOS, dragging just the app to Trash retains saved device settings; an app cannot execute cleanup after arbitrary deletion.

Reset clears cached credentials in known retained ledger files. It cannot clear unknown copies or backups, or remove an extension installed in another app. Remove an unused Fidra extension in Claude/ChatGPT separately; its Fidra connection has already been revoked. If secure credential storage is unavailable, Fidra keeps the current sign-in in memory and requires sign-in after restart; it does not fall back to plaintext session files.

## Invitations

The administrator invites a person and saves the generated `.fidra-invite` file to share privately. Fidra creates the bootstrap snapshot before reporting the invitation ready. The invitation contains a recipient-specific access capability, not the shared-folder passphrase; keep it private. New invitations expire after seven days. Reissuing replaces the token for that email.

The recipient chooses **Join a team → Open invitation**. Fidra fills the recipient details and can infer the shared folder if the invitation is beside its paired token. Otherwise, choose the local shared OneDrive folder once. Set a password for a new account, or enter the existing password when adding another device. Fidra chooses the new local ledger filename automatically. OS double-click invitation-file registration is not included yet.

The OneDrive folder must already be shared with the recipient. An invitation does not grant Microsoft/OneDrive permissions. When files have not arrived yet, Fidra waits and allows cancellation/retry. A join is staged in an isolated file; the destination is published only after snapshot, team identity and account validation succeed. Existing destinations are never overwritten.

Invitation expiry and token deletion do not instantly revoke a group key already received by an offline device. Removing shared-folder access or rotating the group key requires a separate team policy.

## Personal AI

The accepted first distribution route is a one-time private/local plugin installation, with public-directory publication optional. The user journey is plugin-first: install Fidra in ChatGPT, request access, compare the verification code in Fidra, and obtain administrator approval for selected accounts, fields and actions. Approval persists on this device. The application no longer exposes ZIP exports, context/proposal-file exchange, native statement selection for the AI, or hourly reconnection controls. See [the user guide](CHATGPT_SETUP.md) and [the product architecture](plan-ai-plugin-product.md).

The plugin uses a bundled runtime and an installation identity stored through the operating system credential store. Fidra publishes only a loopback discovery address; no financial paths or bearer token are published. Every call proves possession of the installation key against a fresh, single-use challenge. The administrator must approve a matching native request. The app label is self-identified, so the verification code and an intentionally initiated request matter.

Consent is stored encrypted through Electron secure storage, separately from the ledger and sync. It binds the client key, canonical ledger location and database identity, approving person and password identity, permitted accounts, fields and actions. The main process checks current personnel records on every access and again after an asynchronous backup. Members, stale administrator sessions and another ledger/window cannot approve or expand access. Missing or corrupted secure storage fails closed.

Standalone ledgers have no personnel sign-in. A native access-owner setup establishes a local password-protected identity without enabling sync or changing financial data. This owner unlocks access after restarting or locking the device. An existing personnel identity cannot be bypassed by enrolling a standalone owner.

Lock, suspend, sign-out or closure pauses active use; consent remains. On restart, the plugin discovers the current endpoint automatically, and the authorised administrator or unlocked owner resumes approved access. Revocation removes consent immediately on this device; device reset clears it. Offline peers cannot receive instantaneous role revocation through Local Sync.

Tools expose approved connection discovery, context for an explicitly requested date range and account subset, in-memory statement registration, reading the registered source, staging, proposal status and guarded application. The user attaches a statement once in chat; the plugin sends original bytes and Fidra computes the source hash. Uploads are limited to 1 MB and batches to 1,000 rows. CSV values are independently checked for supported layouts; other extraction requires answers to source questions. A client-supplied answer is not independent proof of the user's chat message. Treat statements and ledger text as data, never instructions.

Direct imports create a backup, revalidate scope/source/current state, then atomically add pending actuals and fulfil exact planned occurrences. Retries are idempotent. Existing actuals cannot be edited or deleted, and status approval, SQL, arbitrary files and permission changes are unavailable. The renderer records native Undo. Drafts and undo journals remain window-lifetime state; changing the task range deliberately creates a new scope. Transfers and invoice-linked plans still use their native workflows; statement-total verification and many-to-one matches are not implemented.

A maintainer-only builder (`npm run build:ai-plugin`) creates a platform-specific package containing the adapter, generated tool catalog, skills, Node runtime and OS credential-store binding. It accepts an explicitly supplied official standalone Node runtime. There is no user-specific connection secret or financial data in the archive. The builder also creates `Fidra-private.zip` with a source catalog, installation guide and Mac source-registration launcher. Source registration is a user action and grants no ledger access. Package generation and automated adapters do not establish actual host acceptance.

[OpenAI currently restricts public local-MCP submissions to approved partners](https://developers.openai.com/plugins/deploy/desktop-only). No directory listing has been published or promised. No remote relay, hosted ledger or tunnel has been introduced. The packaging workflow builds artifacts only; publication and real-client acceptance are separate milestones.

## Acceptance still required before release

Automated verification for the replacement connection: 530 unit tests across 49 files, 30 full real-Electron scenarios and all three final personal-AI scenarios pass. TypeScript, targeted lint, bundled skill validation, Mac packaging, demo build and macOS/Windows CI package builds and runtime/native-binding/initialization/tool-discovery checks pass. Financial tests use synthetic isolated data; Electron tests substitute secure storage and do not exercise real Keychain consent. Actual provider conversations, native installed-plugin credential prompts and Windows installed-client behavior remain unverified.

- Fresh downloaded DMG installation, Gatekeeper approval, supported uninstall and reinstall on a clean Mac user account.
- Windows Setup.exe installation, SmartScreen behavior, Squirrel install/update/uninstall events, retained files, multi-window reset and reinstall on real Windows.
- Previous-version installer upgrades on both platforms.
- Install the new platform package through a supported ChatGPT desktop distribution route and complete native admin consent and a real synthetic conversation; repeat client acceptance for Claude.
- Slow/paused OneDrive, placeholder downloads and two physical devices joining or concurrently importing the same source.

These checks remain separate from the automated SQLite, localhost-adapter and real-Electron application tests. No publisher credentials are required or planned for this release target.
