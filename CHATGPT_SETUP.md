# Install the Fidra trial in ChatGPT desktop

This is a private local plugin, with an MCP connection and bundled reconciliation instructions. It is intended for ChatGPT desktop conversations that run locally. Actual ChatGPT installation and conversation acceptance still need to be completed; the automated connector tests do not establish those results.

## 1. Open the current Fidra build

The build containing Personal AI is `out/Fidra-darwin-arm64/Fidra.app`. An older installed copy of Fidra may not contain this feature. For the first trial, open `out/ai-trial/Fidra AI Trial.fdra`; its statement and ledger contain synthetic data.

## 2. Choose what ChatGPT may access

In Fidra, open **Settings → Personal AI**:

1. Choose **ChatGPT** as the desktop app.
2. Select the account and date range. For the synthetic trial, use **General**, **1–31 October 2026**.
3. Keep **description, party, category and activity** selected so ChatGPT can use existing ledger conventions.
4. Enable **Receive statements I attach in my AI chat**.
5. Enable **Add missing entries and fulfil planned payments when I ask in chat**.
6. Select **Share selected context with ChatGPT**, then **Save ChatGPT extension (trial)**.

The two permissions are separate and default off. Leave Fidra open and signed in. Access expires after one hour and ends when the computer locks or sleeps, you sign out, the ledger closes, or you disconnect.

## 3. Install the exported plugin

1. Unzip `Fidra-ChatGPT.zip` into a private, permanent local folder. Keep its contents together, including the hidden `.agents` folder.
2. Open that folder as a project in ChatGPT desktop. Restart ChatGPT if the local source does not appear.
3. Open **Plugins / Plugins Directory**, select the **Fidra trial** source and install **Fidra**.
4. Run the plugin's setup workflow. It should read the selected ledger context and report its permitted accounts, dates and actions without importing anything.

The trial adapter requires Node.js 18 or later available to the desktop app. Node is already installed on this development Mac; discovery by the ChatGPT process still needs checking. Do not paste Fidra's private connection-file contents into a chat.

OpenAI documents [local marketplaces and installation](https://developers.openai.com/plugins/build/plugins) and [desktop-only local MCP plugins](https://developers.openai.com/plugins/deploy/desktop-only). A local source is separate from public plugin submission. Local plugins require a supported desktop surface and a locally running conversation; browser and phone access are outside this trial. If the local source or Plugins Directory is missing, record which ChatGPT surface is available before changing the integration.

## 4. Try a statement

Start a new local conversation with Fidra enabled. Attach `out/ai-trial/October-trial-statement.csv` and ask:

> Reconcile this statement with Fidra and add anything missing. Check for duplicates and corresponding planned payments, reuse my descriptions and activities, and ask me about anything uncertain.

Expected synthetic result:

- The £12 pool payment already exists and is skipped.
- The £15 equipment payment is added and fulfils its planned occurrence.
- The £25 membership payment is added as income.

Fidra should then contain four actual transactions and one fulfilled planned occurrence. The new entries are pending. **Undo this import** in Fidra should restore the two original actuals and the unfulfilled planned occurrence.

## Reconnect or troubleshoot

- **Expired or disconnected:** create a new connection in Fidra for the same ledger and ChatGPT client. The installed plugin reuses the private pairing location. Reload the plugin or start a new conversation if ChatGPT retains an old tool list.
- **Wrong account, dates or permissions:** choose the correct scope in Fidra and reconnect. ChatGPT cannot expand its own access.
- **Cannot launch Node:** check the desktop app's runtime discovery before proceeding. This trial does not bundle Node.
- **No tools or local source:** installation is incomplete. Attaching the ZIP to an ordinary conversation does not install the plugin.

Imports create a backup and audit history and participate in native Undo. The connection cannot edit or delete existing actual transactions or approve their status. Start with the synthetic ledger to verify installation before sharing real financial data.
