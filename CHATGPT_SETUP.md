# Connect Fidra to ChatGPT

Use the private Fidra source for a one-time desktop installation. Public-directory publication is optional and has its own OpenAI approval requirements. The connection and remembered administrator permissions are the same in both routes.

## One-time private installation

The private personal plugin is saved as [Fidra](https://chatgpt.com/plugins/plugins_6ade37900c748191915641562337d0b4).

1. Open that page in ChatGPT desktop and install Fidra, or update an existing installation to **2.0.3**.
2. Keep Fidra open. The current source run with `npm start` and the 0.1.24 desktop app both contain the AI service.
3. Select the plugin in a local chat and ask **Set up Fidra**.
4. Review the matching native request in Fidra as described below. Installation alone grants no ledger access.

Version 2.0.2 displayed the two skills but did not expose the connection tools. The account service omitted the MCP reference while normalizing the portable manifest. Version 2.0.3 uses the compatibility manifest as its sole source, and saved-source read-back now retains `mcpServers: "./.mcp.json"`. Actual desktop tool loading, consent and conversation behavior still require verification; the saved registration is not proof of a live connection.

Maintainers should use **Fidra-account.zip** for Plugin Creator account uploads. It contains the same runtime, adapter, catalog and skills as the portable package, with the account-compatible manifest. It contains no financial data or connection credential. It is an installation archive, not a ledger context/proposal export.

### Alternative local-source installation

**Fidra-private.zip** remains available for a private local catalog. Extract its Fidra folder into a permanent location, then on the development Mac run **Add Fidra source.command** once. Alternatively, enter the folder and run `codex plugin marketplace add .`. Restart the desktop client and install from the Fidra source. Source registration grants no ledger access. Local-source availability and discovery depend on the client; this route is separate from the personal plugin above. [Official local-plugin instructions](https://developers.openai.com/plugins/build/plugins)

## Approve and use Fidra

Once the plugin is installed:

1. Open Fidra and sign in as a ledger administrator.
2. Run the Fidra plugin’s setup in ChatGPT. It requests access and shows a verification code.
3. In Fidra, choose **Review connection request**. Check that the code matches, choose the accounts and details to share, and approve the actions the plugin may take.
4. Continue in ChatGPT: attach a bank statement and ask it to reconcile and add missing entries.

Approval is remembered on this device. Fidra must be open, with the approved administrator signed in. Locking, sleeping or signing out pauses access; it does not remove the plugin or its approved permissions. A standalone ledger with no administrator first requires an access owner in **Settings → Connected AI apps**; that owner password is entered only in Fidra.

The plugin receives a bundled runtime. Users do not need to install Node, export context, save proposal files or renew a connection each hour. The administrator can revoke access in **Settings → Connected AI apps**. Changing permissions requires revocation and a fresh approval.

Fidra validates each request and import. It checks source evidence, duplicates, planned matches and current data, makes a backup before a direct import, records an audit trail and supports native Undo. New transactions start pending. The plugin cannot edit or delete existing actuals or approve transaction status.

Development acceptance is separate from directory publication. Real ChatGPT installation and conversation behavior and Windows runtime behavior still require testing. Start with synthetic data when those tests become available.
