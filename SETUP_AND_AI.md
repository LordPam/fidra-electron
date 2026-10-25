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

For the user-assisted ChatGPT trial, follow [the installation walkthrough](CHATGPT_SETUP.md).

In **Settings → Personal AI**, select accounts, dates, optional context fields and bank statements explicitly. Dates, amounts, direction and account names are part of the selected ledger context. A local connection still sends selected tool results to the chosen AI provider.

**Primary flow, clarified by the owner on 24 October:** attach a statement in ChatGPT and say “reconcile this with Fidra and add anything missing.” The extension may do that directly when the user has enabled both **Receive statements I attach in my AI chat** and **Add missing entries and fulfil planned payments when I ask in chat**. These permissions default off, are chosen in Fidra and require reconnecting to change. Existing draft-only connections do not gain write access automatically.

With those permissions, the extension registers the original chat attachment, reads the permitted ledger context, stages a batch, asks about flagged rows in the conversation, and applies the exact batch through `apply_reconciliation`. The server checks source identity and evidence, account/date scope, duplicates, planned availability, blockers, draft digest and current ledger state. Canonical signed ISO-date CSV values are independently checked against their original rows; unsupported CSV layouts, text and PDF extraction require confirmation. Chat attachment uploads are limited to 1 MB and stay in memory; larger originals can be selected in Fidra. A hash proves the bytes Fidra received, not the model's interpretation or that its upload was the original chat attachment.

Before every direct import, Fidra must successfully create a normal financial backup, then recheck access and source state. It adds only pending actuals and fulfils exact planned occurrences; existing actuals cannot be edited/deleted, and transaction status cannot be approved. Each connection may change at most 1,000 rows. The audit records the AI client, provenance and answers supplied for flagged rows. Answers are supplied by the AI client, not independently attested chat messages; the workflow must ask the user rather than manufacture confirmation. Model interpretation can still be wrong. Native Undo is recorded for the batch and guards later edits. Retries of the same committed proposal are idempotent; an undone batch cannot be silently reapplied through the AI tool.

Keep Fidra open and signed in. A connection lasts one hour and is bound to the current ledger window. It stops on sign-out, ledger close, computer lock, suspend, reset or disconnect. There is no raw database, arbitrary file, unrestricted editing/deletion, permission-expansion or transaction-status approval tool.

**Claude desktop connection:** share the selected context, save the Claude connection, then open the `.mcpb` in Claude Desktop. It contains the bundled adapter and a path to a private, revocable local pairing file; no bearer token is exported in the package. Renewing the connection for the same ledger/client reuses that pairing location. Actual installation and conversation behavior in Claude still require acceptance testing.

**ChatGPT file exchange (fallback):** share the selected context, export it and attach it with the selected statement in your desktop chat. Ask the AI to follow the included proposal schema and ask about ambiguous descriptions, activities, duplicates or planned payments. Save its proposal JSON and use **Open proposal file** in Fidra. This fallback still requires native approval. The exported context contains no local path or connection token. The source hash must match a statement selected in Fidra.

A ChatGPT local-plugin development package is also available through **Save ChatGPT extension (trial)**. It bundles an onboarding skill and `fidra-reconcile`: account/source selection, duplicate decisions, historical conventions, planned occurrence matching, uncertainty questions, draft staging, permission-scoped direct application and native approval fallback. The same maintained workflow is automatically sent in the MCP initialization response for both ChatGPT and Claude; it is also included in file-context exports. A plain chat without this extension or exported context does not know the Fidra workflow. Instructions guide the model; the main-process permissions and approval checks enforce the financial boundary independently.

[OpenAI documents plugins containing skills and MCP tools](https://developers.openai.com/plugins/build/plugins) and [local-source testing](https://developers.openai.com/plugins/deploy/connect-chatgpt). Public local-MCP submissions require approved-partner access, which is separate from private local-source testing. Actual private ChatGPT installation and model behavior remain unproven; the file exchange does not depend on that access. No relay or public server is introduced.

CSV/text can be read through the selected-source tool. For PDFs, attach the same selected PDF in the AI conversation for extraction; Fidra verifies its hash, but does not independently OCR and prove extracted values. Review the source evidence before approving.

Draft-only connections stage proposals without applying them. In Fidra, review the original bank evidence, normalized fields, duplicate candidates and exact planned occurrence, confirm flagged rows, then approve the exact batch. Direct-add connections can perform the equivalent scoped import from the conversation as described above. Planned fulfilment and provenance are written atomically with the actual entries. Changes since preview require a new draft.

**Undo this import** uses Fidra's undo stack and refuses to remove entries that have since been edited, attached to or linked elsewhere. Keeping an already-present actual and fulfilling a planned occurrence is supported. Transfers and invoice-linked plans are blocked with an instruction to use their existing Fidra workflows. Different source exports without stable bank transaction IDs can still need human duplicate review. Statement-total verification and many-to-one matches are not implemented.

Drafts and undo journals currently live only for the open ledger window. Skipped personal statement rows are omitted from the synced provenance. An imported financial row and its source evidence do become part of the team's ledger and audit history. Private ChatGPT exports also include a local marketplace catalog at `.agents/plugins/marketplace.json`: unzip into a private folder, open that folder in ChatGPT desktop, restart if necessary, and select the Fidra trial source in the Plugins Directory. This trial adapter requires a local Node runtime. Actual host installation remains user-assisted; computer use cannot operate the ChatGPT/Codex host application.

## Acceptance still required before release

Automated verification: the initial implementation passed 516 unit tests; direct-access additions passed 524 unit tests across 47 files and all 31 real-Electron scenarios; TypeScript and targeted lint pass. The unsigned/ad-hoc Mac package and an isolated browser demo build succeed. All financial test data was synthetic and isolated from real ledgers.

- Fresh downloaded DMG installation, Gatekeeper approval, supported uninstall and reinstall on a clean Mac user account.
- Windows Setup.exe installation, SmartScreen behavior, Squirrel install/update/uninstall events, retained files, multi-window reset and reinstall on real Windows.
- Previous-version installer upgrades on both platforms.
- Install the exported Claude extension and test a synthetic statement in an actual conversation; verify private ChatGPT local-plugin eligibility/install behavior separately.
- Slow/paused OneDrive, placeholder downloads and two physical devices joining or concurrently importing the same source.

These checks remain separate from the automated SQLite, localhost-adapter and real-Electron application tests. No publisher credentials are required or planned for this release target.
