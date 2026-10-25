# Connect Fidra to ChatGPT

The intended installation starts in ChatGPT desktop’s Plugins tab. Public directory availability is pending OpenAI’s approval for local MCP distribution; Fidra is not currently listed. The exported ZIP/context-file trial workflow has been removed from the app.

Once the plugin is installed:

1. Open Fidra and sign in as a ledger administrator.
2. Run the Fidra plugin’s setup in ChatGPT. It requests access and shows a verification code.
3. In Fidra, choose **Review connection request**. Check that the code matches, choose the accounts and details to share, and approve the actions the plugin may take.
4. Continue in ChatGPT: attach a bank statement and ask it to reconcile and add missing entries.

Approval is remembered on this device. Fidra must be open, with the approved administrator signed in. Locking, sleeping or signing out pauses access; it does not remove the plugin or its approved permissions. A standalone ledger with no administrator first requires an access owner in **Settings → Connected AI apps**; that owner password is entered only in Fidra.

The plugin receives a bundled runtime. Users do not need to install Node, export context, save proposal files or renew a connection each hour. The administrator can revoke access in **Settings → Connected AI apps**. Changing permissions requires revocation and a fresh approval.

Fidra validates each request and import. It checks source evidence, duplicates, planned matches and current data, makes a backup before a direct import, records an audit trail and supports native Undo. New transactions start pending. The plugin cannot edit or delete existing actuals or approve transaction status.

Development acceptance is separate from directory publication. Real ChatGPT installation and conversation behavior and Windows runtime behavior still require testing. Start with synthetic data when those tests become available.
