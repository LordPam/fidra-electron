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

Run `npm run build:ai-plugin` with `FIDRA_PLUGIN_NODE_RUNTIME` pointing to a checksum-verified official standalone Node 22+ binary for the target platform. The builder rejects a mismatched architecture or a Mac runtime with external library dependencies. It packages the runtime, OS credential-store binding, adapter, generated catalog, icon and skills into `out/ai-plugin/<platform>-<arch>/Fidra-plugin.zip`. No user-specific connection package is generated. The manual GitHub Actions workflow builds platform candidates only; it does not publish them.

Automated tests use synthetic ledgers and in-memory credentials. Electron tests substitute a deterministic secure-storage implementation inside the isolated test process; they do not read/write the developer's Keychain. Packaged-runtime smoke checks pass locally and in macOS/Windows CI, exercising initialization and offline tool discovery without requesting a stored installation key. These checks do not establish installed-plugin Keychain prompts, ChatGPT conversation behavior, Windows execution or public-directory availability.

OpenAI public local-MCP publication currently requires approved-partner eligibility and review. The current platform artifacts are candidates for testing and distribution review. The final directory delivery/target-platform selection must be established with OpenAI before public release. Application publisher signing remains deferred by owner decision.
