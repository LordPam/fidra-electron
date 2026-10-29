# Fidra desktop AI interface

## Boundary

ChatGPT talks MCP over stdio to the bundled adapter. The adapter discovers the running Fidra process from `~/.fidra/ai-access/endpoint.json`. That file contains only a loopback URL and a process identity; it contains no bearer credential or ledger path. No remote server, relay or tunnel is involved.

The adapter stores its Ed25519 installation private key in the operating system credential store using `@napi-rs/keyring`. There is no plaintext fallback. Fidra stores administrator approvals encrypted through Electron secure storage in its per-device `ai-access` directory; approvals and credentials never enter Local Sync. Reset removes approvals, so a surviving client installation key has no authority until another native approval.

Each HTTP call obtains a 30-second, single-use random challenge. The client signs the UTF-8 JSON encoding of `[serverId, challengeId, challengeValue, client, request]`. Fidra verifies the Ed25519 signature and consumes the challenge before dispatch. Challenge proofs are not reusable access tokens. Browser Origin headers and unexpected Host/path/method values are rejected. Connections, request bodies, pending challenges and pending consent requests have bounded sizes/counts/timeouts.

The claimed app label is not independent proof of ChatGPT/Claude publisher identity. The administrator must initiate the connection intentionally and compare the native verification code with the plugin's code. A local process cannot get financial access by merely claiming a client name.

## Tools

- `connect_fidra`: request native consent. `newConnection: true` requests an additional or moved ledger; it never expands an existing grant.
- `list_connections`: discover only this installation's approved connections. Paused connections disclose no ledger filename or account names.
- `read_context`: require the user-requested `from`/`to` range, optionally narrow the approved accounts, and choose `connectionId` when several ledgers are approved. Maximum range: one year; maximum context: 3,000 actuals/occurrences.
- `register_statement`: original bytes explicitly attached by the user, stored only in RAM. Maximum 1 MB; source hash computed by Fidra.
- `read_statement`: read a registered source within the active session. PDF extraction uses the original chat attachment, not a second file selection.
- `stage_reconciliation` / `get_proposal`: prepare/check a validated batch and its questions, without mutating the ledger.
- `apply_reconciliation`: add pending actuals and fulfil exact planned occurrences within approved permission. Maximum 1,000 rows per batch; backup, scope/source/current-state revalidation, atomic commit, idempotency, audit and native Undo remain enforced.

The tool catalog is generated from the server definitions during the package build. The installed adapter supplies initialization, skills and tool discovery even when Fidra is closed, so opening Fidra later does not require reinstalling the plugin. Financial calls require the live signed-request path.

Consent binds a client public key to the canonical ledger location, database identity and approving Fidra identity. The broker reads current personnel roles and password identity for every operation and after an asynchronous backup. Closed/replaced windows, sign-out, lock, suspension, demotion, password change and revocation cannot silently inherit access. A standalone ledger uses explicitly enrolled local ownership; an uninitialised or disconnected team identity cannot be bypassed with owner enrollment. Broader permission changes require revocation and a new native approval.

Task scopes are in-memory state. Changing the context range/account subset deliberately starts a new scope, invalidating the prior session's drafts. Draft and undo journals are window-lifetime state. Native proposal visibility is limited to currently authorised sessions so a later sign-in cannot read a previous identity's statement draft. No tool exposes SQL, arbitrary files, credentials, status approval, existing-actual editing/deletion, native approval or permission expansion.

## Build and acceptance

Run `npm run build:ai-plugin` with `FIDRA_PLUGIN_NODE_RUNTIME` pointing to a checksum-verified official standalone Node 22+ binary for the target platform. The builder rejects a mismatched architecture or a Mac runtime with external library dependencies. It packages the runtime, OS credential-store binding, adapter, generated catalog, icon and skills into `out/ai-plugin/<platform>-<arch>/Fidra-plugin.zip`. The build also emits `Fidra-account.zip` for Plugin Creator uploads: the same payload with only `.codex-plugin/plugin.json` and `.mcp.json` as manifest sources, including the explicit `mcpServers` reference. In observed account ingestion, a portable root manifest caused that compatibility reference to be omitted; a compatibility-only update to 2.0.3 retained it on read-back. The smoke check asserts equivalent launch configuration and byte-identical retained payload, not just file presence. Actual client loading remains an acceptance check. The same build also emits `Fidra-private.zip`, wrapping the plugin in a private local-source catalog and install guide. On Mac it includes an explicit user-run source-registration launcher; no host configuration is changed by building or testing the archive. No user-specific connection package is generated. The manual GitHub Actions workflow builds platform candidates only; it does not publish them.

Automated tests use synthetic ledgers and in-memory credentials. Electron tests substitute a deterministic secure-storage implementation for approval/session operations inside the isolated test process. The owner reported transient Keychain warnings during separate packaged-app launch checks; the cause is unconfirmed and those live launches were stopped. Mocked approval storage does not establish the absence of operating-system prompts during native startup. Packaged-runtime smoke checks pass locally and in macOS/Windows CI, exercising initialization and offline tool discovery without requesting a stored installation key. These checks do not establish installed-plugin Keychain prompts, ChatGPT conversation behavior, Windows execution or public-directory availability.

OpenAI public local-MCP publication currently requires approved-partner eligibility and review. The current platform artifacts are candidates for testing and distribution review. The final directory delivery/target-platform selection must be established with OpenAI before public release. Application publisher signing remains deferred by owner decision.

## Local Codex launcher repair (26 October 2026)

The account-installed 2.0.4 package is present, but this desktop client reports `No such file or directory` when starting the `${PLUGIN_ROOT}` launcher. Running the same bundled runtime and adapter by absolute path works. Version 2.0.4 also removes host MCP `_meta` from the tool-call envelope before signing for the installed app's strict broker; domain arguments and native access checks remain enforced.

For this Mac, the selected package's code, runtime, native binding, catalog, skills and licenses were copied unchanged into `~/.fidra/ai-plugin/2.0.4/`. All 20 payload files were hash-checked against the installed package, including its recorded official Node runtime checksum. This folder contains plugin code only, with no copied approvals, credentials, statements or ledgers. It is independent of the plugin cache and the project build output.

The bundled Codex CLI registered a direct `mcp_servers.fidra` entry in `~/.codex/config.toml`, using full paths to that folder's `runtime/node` and `server/server.cjs`. The existing private plugin remains installed for its skills. Its failing duplicate launcher is disabled using the supported plugin-scoped policy:

```toml
[plugins."fidra@created-by-me-remote".mcp_servers.fidra]
enabled = false
```

No approval mode was relaxed. The original host settings are backed up as `~/.codex/config.toml.before-fidra-launcher-repair`. The same Codex binary used by the desktop app discovered all eight Fidra tools through `mcpServerStatus/list` from the saved configuration, without overrides or a model/chat run. The relocated connector's metadata-only `list_connections` check confirmed the same active approval and account/action scope, including compatibility with host `_meta`. No transaction history was read or changed.

After the owner restarted Codex, the native `mcp__fidra__list_connections` tool succeeded directly in the existing chat and returned the same active approval and account/action scope. This verifies actual desktop-chat tool loading and approval reuse after restart, beyond the isolated discovery check. This is a machine-local compatibility repair, not a portable directory-package fix or Windows acceptance. Updating the account plugin does not update this separate pinned connector: future adapter updates must replace the local payload deliberately and recheck discovery. Once the client's bundled launcher works, remove the direct entry with `codex mcp remove fidra` and remove the plugin-scoped disable override to return to the normal bundled route. Keep the existing OS installation identity and Fidra approvals intact.


## Application-operation expansion — source checkpoint, 26 October 2026

The working source now has 61 shared application entry points and 26 native capability choices. Existing approvals acquire no new capabilities or future-account scope. The native approval dialog reads account choices directly when opened, including when Settings is the first mounted view.

The generated catalogue has 19 tools: the original reconciliation/setup tools plus scoped domain reads, `run_sync` and `create_backup`. Sensitive settings, credential material and local paths are excluded; destructive administration and general ledger writes remain under implementation in `plan-ai-ledger-operations.md`. The extension does not expose raw repositories, SQL, generic IPC or row-restore calls.

An isolated build in `/private/tmp/fidra-operations-plugin` passed archive inspection and bundled-runtime offline initialization/tool discovery with all 19 tools and three skills. The offline process used a temporary home, did not request credentials or connect to a ledger, and left that home empty. `FIDRA_PLUGIN_OUTPUT_DIR` supports this validation without overwriting an existing private plugin source. This is a development artifact using the current build version, not a release to install. The installed connector, pinned launcher and existing live approvals were not changed.

The source passes 663 unit tests across 58 files, typecheck and catalogue/skill validation. The local app build and initial 14 real-Electron workflows passed. A final rerun passed 13 workflows and all transaction/balance assertions, but one stderr assertion captured a Chromium `blink.mojom.WidgetHost` message rejection; that exact test then passed three consecutive isolated repeats against the final build. The harness was not changed to suppress the message. All four approval/connection scenarios passed once more after the final consent wording clarification. Full ledger/admin coverage and matched release versions remain unfinished; no app/plugin publication or installation was performed.


## Packaged-extension acceptance — 27 October 2026

The live in-chat installed `list_connections` tool responds, but both saved approvals are paused. The installed tool inventory remains the original eight; the 19-tool candidate has not been installed or published. No financial history was requested from those approvals.

Fresh isolated builds in `/private/tmp/fidra-oct27-plugin` and the local app output were tested. Archive inspection confirms 19 unique tools, the ledger skill, an unchanged adapter and the recorded bundled-runtime checksum. Two new scenarios in `e2e/packaged-fidra.e2e.ts` run that bundled runtime and actual stdio adapter through signed localhost requests into a real Electron window. They use temporary ledgers and synthetic native approvals, replace only the connector’s OS credential-store interface and the app’s secure-storage crypto, and never touch a real Keychain or financial file.

Both packaged scenarios pass: account and field restrictions, withheld cross-account planned transfers, strict arguments, invoice JSON projection, category/activity/settings reads, personnel role limits and credential redaction, backup retry protection, native revocation, lock/unlock, configured team sync and sign-out. A standalone access owner cannot act as a team administrator. Arbitrary SQL and caller-supplied permission/sync-secret arguments are rejected. The native app test paths seed and inspect data through typed application IPC, without raw financial database edits.

The fresh unit/integration run passes 663 tests across 58 files. Typecheck, added-test lint and whitespace checks pass. The full desktop run passed 30 of 34 scenarios; four failed, and worker cleanup also reported errors. Failures involved a multi-window reset page closure, a planned-dialog click timeout, startup readiness and invoice-test teardown. All four passed unchanged in a separate isolated rerun (16.4 seconds). The first run is retained as a failure, not presented as a clean full-suite pass; root cause is unconfirmed. The backlog tracks follow-up. No product assertions were suppressed and no speculative production fix was made.

Test logs: `/private/tmp/fidra-oct27-unit-tests.log`, `/private/tmp/fidra-oct27-desktop-tests.log`, `/private/tmp/fidra-oct27-failed-recheck.log`. Mac development-candidate results do not establish Windows, actual host-chat candidate installation, real OS credential prompts or the still-unimplemented broader ledger/admin write coverage.


## Updating the repaired local helper (0.1.27 onwards)

For the explicitly installed `~/.fidra/ai-plugin/2.0.4` compatibility copy, packaged Fidra refreshes the adapter, offline tool catalogue and three workflow skills when it starts. It recognises the original adapter by its SHA-256 and thereafter accepts only its stable bootstrap. Unknown adapters and symbolic links are refused. A complete content-addressed snapshot is verified and selected atomically; startup failure leaves ledger use independent of the helper. The bootstrap verifies the selected files before executing them. Existing runtime, credential binding, installation identity, approvals and host configuration are never replaced. This updater never edits a host-managed plugin cache and does not install a helper where none exists.

Update Fidra, reopen it, then fully quit and reopen the AI desktop app. This is sufficient for the repaired local tool server. The account plugin’s packaged skills have their own private release; updating that plugin does not replace the direct helper. Existing grants stay narrow. Additional permissions require native revoke and renewed matching-code approval.

The released 0.1.27 tool catalogue has 19 tools. General ledger writes and the remaining administration workflows are still in development; do not advertise them as available.


Released 2026-10-29: Fidra 0.1.27 and private account plugin 2.0.5. Both platform release gates passed; public update announcements were signature-verified after publication. This does not install the update into the owner’s running app or refresh this chat’s currently cached eight-tool server. The owner must install/reopen Fidra and restart the AI desktop app. Existing grants remain unchanged; new capabilities need a fresh native approval.
