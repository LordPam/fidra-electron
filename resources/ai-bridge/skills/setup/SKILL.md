---
name: setup
description: Connect the installed Fidra plugin through one-time administrator approval and check its permitted ledgers and actions.
---

# Connect Fidra

Keep Fidra open. Call `list_connections` first. If this installation has no approved connection, call `connect_fidra`, show its verification code, and ask a Fidra administrator to review the matching request in Fidra. The administrator selects accounts, fields and actions in a native permission screen. Do not approve or click that screen on their behalf. Do not request passwords, owner passwords, keys or credential files.

The app identifies itself by its installation key; its ChatGPT/Claude label is not independent proof of publisher identity. The user must compare the code with the request they initiated. Installing the plugin alone grants no financial access.

If the ledger is standalone and has no administrator identity, explain that its owner first sets up AI access ownership in Fidra Settings → Connected AI apps. Owner setup and password entry happen in Fidra, never in this chat. Existing team ledgers require a Fidra administrator.

After approval, call `list_connections` again. Summarize the permitted accounts and actions without dumping financial history. If several ledgers are approved, ask which to use and supply its `connectionId` on subsequent calls. Do not choose by window focus. To connect an additional or moved ledger, call `connect_fidra` with `newConnection: true` and obtain a new native approval. Changing an existing permission first requires its administrator to revoke it.

Installation and consent persist. Paused access means Fidra is closed, the computer is locked, the authorised user is signed out, or the standalone owner needs to unlock access. Ask the user to open/unlock Fidra; do not require package exports, context files, plugin reinstallation or hourly reconnection. Revoked permissions require a new administrator approval. Never expand scope automatically.

When the user requests reconciliation, continue with `fidra-reconcile` and read only the account/date context needed for that request. Do not import or stage transactions solely to test setup. Do not claim a public-directory listing or actual client installation has been verified from a successful connector test.

For supported ledger reads, backups and synchronization, continue with `fidra-ledger`. Check each capability in `list_connections`; new tools never expand an existing approval. If the installed app does not support a tool, explain that both Fidra and the plugin need matching updates.
