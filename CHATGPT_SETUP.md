# Connect Fidra to ChatGPT

Use the private Fidra source for a one-time desktop installation. Public-directory publication is optional and has its own OpenAI approval requirements. The connection and remembered administrator permissions are the same in both routes.

## One-time private installation

1. Get the matching **Fidra-private.zip** package for your computer and unzip its **Fidra** folder into a permanent local location.
2. On the development Mac, double-click **Add Fidra source.command** in that folder. It uses the installed official Codex command to register the source. This step grants no ledger access.
3. Restart ChatGPT desktop, open **Plugins / Plugins Directory**, choose the **Fidra** source and install **Fidra**.
4. Run the installed plugin's setup, then approve the matching request inside Fidra as described below.

The source-registration command is already available on this Mac. An alternative is to enter the extracted Fidra folder in Terminal/PowerShell and run `codex plugin marketplace add .`. OpenAI also documents project-local catalogs; the included `.agents/plugins/marketplace.json` supports that route where the desktop client discovers the project source. Actual source discovery and installation on your account still need checking. [Official local-plugin instructions](https://developers.openai.com/plugins/build/plugins)

Do not attach the ZIP to a chat or export ledger context. The ZIP contains the plugin itself, its own runtime and instructions. It has no financial data or connection credential. The retired per-user context/proposal-file workflow is not part of installation.

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
