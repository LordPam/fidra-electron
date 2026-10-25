# Fidra plugin: install once, administrator-approved access

Owner clarification: 2026-10-25. This supersedes the manual installation/export journey in `CHATGPT_SETUP.md` and the temporary-connection UX in the earlier AI plan. Implementation status is recorded below; public distribution and real-client acceptance remain separate milestones.

## Required experience

1. Find Fidra in ChatGPT's Plugins tab and install it.
2. First use asks to connect Fidra. A Fidra administrator approves the ledger, allowed data and actions through a trusted Fidra permission screen. Installing the plugin alone grants no financial access.
3. Installation and approved permissions persist. Later conversations use the connection automatically while Fidra is available and the appropriate user is signed in. Expiring session tokens renew without repeating consent.
4. Ask ChatGPT to reconcile a bank statement and add missing entries. The plugin discovers typed tools and instructions automatically, asks questions in chat, and uses guarded domain operations.
5. Administrators can inspect, restrict and revoke connected clients in Fidra. Broader access requires new approval.

No ZIP export, project-folder setup, context JSON, proposal-file round trip, separate runtime installation or hourly manual reconnection belongs in the ordinary product journey. Attaching a statement in chat is normal task input; selecting it again in Fidra is unnecessary. The former file-exchange trial has been removed.

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

## Implemented foundation (2026-10-25)

The manual export/file-exchange UI and IPC have been removed. The main-process broker now supports plugin-initiated native approval, encrypted durable consent, explicit standalone-owner enrollment, signed single-use request proofs, scope and current-role checks, restart discovery, pause/resume, revocation and device reset. The adapter stores its installation key through the OS credential store. The maintainer package includes a runtime, credential-store binding, generated tool catalog and updated skills.

Automated tests cover the broker and app. Actual ChatGPT installation, OS credential-store prompts in the installed plugin, real conversation behavior, Windows acceptance and directory publication remain unverified. Do not describe these as completed from passing connector tests.

## Distribution options

Owner accepted one-time private plugin installation on 25 October. The first route is a local source catalog and installation from the desktop Plugins Directory, followed by native Fidra administrator approval. Public listing is optional; private client discovery/install behavior remains to be verified.

[OpenAI's desktop-only plugin documentation](https://developers.openai.com/plugins/deploy/desktop-only) currently limits public local-MCP submissions to approved partners. Directory listing requires that eligibility, review and publication; a local development marketplace does not supply it. Establish the distribution route before claiming users can find Fidra in the public Plugins tab. A remote HTTPS MCP integration has a different authentication and reachability architecture and must not be introduced silently.

For remote integrations, [OpenAI documents OAuth authentication](https://developers.openai.com/plugins/build/auth). That does not by itself establish the consent UI or persistent pairing mechanism for a local stdio plugin; those need implementation and real-client testing.

Acceptance requires a clean desktop installation initiated from Plugins, a real admin approval, non-admin denial, a second conversation and app restart without repeating setup, scoped reconciliation of synthetic data, revocation and identity-switch tests, plus macOS and Windows runtime coverage. Public publication is a separate external milestone.
