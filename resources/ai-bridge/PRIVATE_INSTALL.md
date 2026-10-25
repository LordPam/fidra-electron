# Install the private Fidra plugin once

Keep this Fidra folder in a permanent local location. It contains the runtime, tools, setup instructions and source catalog; it contains no account data or connection credentials.

## Add the source

On the development Mac, double-click **Add Fidra source.command**. It uses the installed, official Codex command to register this folder as a private plugin source. This step does not install the plugin, approve access, or change any financial data. Review the script before running it if desired. Do not override an operating-system policy that blocks it.

Alternatively, in Terminal or PowerShell, enter this folder and run:

```
codex plugin marketplace add .
```

The Codex command must already be available for that registration method. OpenAI also documents opening a project with its own `.agents/plugins/marketplace.json`; that catalog is included here. Discovery depends on the desktop client/project surface. If the source is not visible, report what Plugins shows rather than exporting ledger context or changing connection permissions.

## Install in ChatGPT desktop

1. Restart ChatGPT desktop after adding the source.
2. Open **Plugins / Plugins Directory**, choose the **Fidra** local source and install **Fidra**.
3. Keep Fidra open, with the intended ledger administrator signed in, and run the plugin's setup.
4. The plugin shows a verification code. In Fidra, choose **Review connection request**, compare the code, select the permitted accounts/details/actions and approve.
5. In a new local chat with Fidra enabled, attach a bank statement and ask it to reconcile and add missing entries. Start with synthetic data.

A standalone ledger without administrator accounts first needs an access owner in **Fidra Settings → Connected AI apps**. Passwords are entered only in Fidra. Existing team administrator permissions cannot be bypassed by installing the plugin.

Installation and approved permissions are remembered. Locking, signing out or closing Fidra pauses access. Revoke access in Fidra Settings. No context export, proposal-file exchange, hourly reconnection or separate Node installation is needed.

Actual discovery, installation, OS credential prompts and conversation behavior still require acceptance on your ChatGPT account. The package's automated runtime/catalog checks do not establish those results. Public directory publication is a separate optional route.

Official instructions: https://developers.openai.com/plugins/build/plugins
