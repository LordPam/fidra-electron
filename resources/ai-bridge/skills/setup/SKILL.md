---
name: setup
description: Check a newly installed Fidra extension connection and guide the user through selecting the ledger context and bank statement to share.
---

# Set up Fidra

Explain that the extension reads selected financial context. A draft-only connection needs approval inside Fidra; an explicitly add-enabled connection can add missing entries and fulfil planned payments when the user asks in chat. Existing actuals cannot be edited or deleted. Selected tool results are shared with their AI provider.

Try Fidra's `read_context`. If the tool is missing, report that the extension's local server is not connected; do not claim that installation succeeded. Ask the user to keep Fidra open and signed in and check the extension's connection status. Do not read private pairing files or request tokens.

If access is denied or expired, direct the user to Fidra Settings → Personal AI: choose this desktop client, select accounts, dates and optional fields, then choose whether to allow statements attached in chat and whether to allow adding missing entries. Share the selected context. Permission changes require reconnecting; do not expand them automatically. The connection ends after one hour or when the ledger closes, the user signs out, or the computer locks.

When context is available, summarize account names, date range, enabled permissions and selected statement names without dumping financial history. If the user attached a statement and upload permission is enabled, continue with that attachment; do not require a second selection in Fidra. If no statement is available, ask for an attachment or a native Fidra selection. If several accounts/statements are plausible, ask which to reconcile.

Continue with `fidra-reconcile` when the user wants to reconcile a statement. Do not create a draft solely as an installation test. Prefer the synthetic trial ledger when the user wants a demonstration.
