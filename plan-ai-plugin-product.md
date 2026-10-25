# Fidra plugin: install once, administrator-approved access

Owner clarification: 2026-10-25. This supersedes the manual installation/export journey in `CHATGPT_SETUP.md` and the temporary-connection UX in the earlier AI plan. It describes required work, not implemented behavior.

## Required experience

1. Find Fidra in ChatGPT's Plugins tab and install it.
2. First use asks to connect Fidra. A Fidra administrator approves the ledger, allowed data and actions through a trusted Fidra permission screen. Installing the plugin alone grants no financial access.
3. Installation and approved permissions persist. Later conversations use the connection automatically while Fidra is available and the appropriate user is signed in. Expiring session tokens renew without repeating consent.
4. Ask ChatGPT to reconcile a bank statement and add missing entries. The plugin discovers typed tools and instructions automatically, asks questions in chat, and uses guarded domain operations.
5. Administrators can inspect, restrict and revoke connected clients in Fidra. Broader access requires new approval.

No ZIP export, project-folder setup, context JSON, proposal-file round trip, separate runtime installation or hourly manual reconnection belongs in the ordinary product journey. Attaching a statement in chat is normal task input; selecting it again in Fidra is unnecessary. File exchange remains an optional fallback.

## Application boundary

Use a bundled local MCP adapter between ChatGPT desktop and the running Fidra application. Discovery and connection are internal product behavior. Preserve local SQLite as the operational store; do not add a hosted ledger, public database port or tunnel merely to work around distribution restrictions. Desktop-first remains the agreed scope.

Expose a small typed API for connection status, permitted account discovery, transaction lookup, historical conventions, planned occurrences, statement reconciliation preview and validated application. These are domain operations, with explicit schemas and model-facing descriptions. The model receives tool discovery and workflow instructions; users do not teach it the protocol or move context files.

Reuse the existing reconciliation validation, source checks, duplicate detection, planned-fulfilment rules, atomic pending imports, idempotency, backup, audit and undo. Keep raw SQL, arbitrary filesystem access, permission changes, edits/deletions of existing actuals and transaction-status approval unavailable.

## Authorization work still required

- Separate durable authorization from short-lived connection credentials. Bind consent to the actual ledger identity, client installation and authorized Fidra identity; reconnects and multiple windows must not silently switch ledgers or users.
- Admin approval must be enforced by the main process using current personnel state. A ChatGPT permission prompt or a model statement is not proof of Fidra administrator authority. Ordinary members cannot issue or expand grants. Define an explicit owner/admin enrollment path for standalone ledgers, which currently have no personnel sign-in; never silently equate an unauthenticated standalone window with a verified administrator.
- Store credentials with the existing secure-storage boundary. Do not sync bearer tokens, export them in packages, return them in tools, or persist them unencrypted as a substitute for secure storage. Rotate short-lived credentials automatically under the durable consent.
- Lock, suspend, sign-out and close suspend active access; they do not uninstall the plugin or discard approved consent. Restore access only after the authorized user returns. Revocation, device reset and personnel/role changes must disable access; test these separately from token expiration. Do not promise instant cross-device revocation while peers are offline.
- Consent defines permitted ledgers/accounts, context fields and actions. Each task fetches only the data needed within that boundary. Preserve explicit user selection of financial data shared with an AI provider; durable consent is not blanket permission to dump an entire ledger. Task date filters should not require recreating the installation or granting fresh consent within an already approved boundary.
- Record the approver, requesting identity, scope, client and subsequent activity. ChatGPT's own tool-confirmation controls remain under OpenAI's control and may still appear.

## Current implementation gap

The pushed implementation supplies useful guarded reconciliation tools and an automated-testable adapter. Its installation still requires a locally exported development package; its grants are one-hour, window-bound and manually recreated. Grant creation checks sign-in for authenticated ledgers but does not require an administrator. It does not satisfy the product experience above. Do not describe its automated tests as acceptance of directory installation or persistent admin consent.

## Distribution dependency

[OpenAI's desktop-only plugin documentation](https://developers.openai.com/plugins/deploy/desktop-only) currently limits public local-MCP submissions to approved partners. Directory listing requires that eligibility, review and publication; a local development marketplace does not supply it. Establish the distribution route before claiming users can find Fidra in the public Plugins tab. A remote HTTPS MCP integration has a different authentication and reachability architecture and must not be introduced silently.

For remote integrations, [OpenAI documents OAuth authentication](https://developers.openai.com/plugins/build/auth). That does not by itself establish the consent UI or persistent pairing mechanism for a local stdio plugin; those need implementation and real-client testing.

Acceptance requires a clean desktop installation initiated from Plugins, a real admin approval, non-admin denial, a second conversation and app restart without repeating setup, scoped reconciliation of synthetic data, revocation and identity-switch tests, plus macOS and Windows runtime coverage. Public publication is a separate external milestone.
