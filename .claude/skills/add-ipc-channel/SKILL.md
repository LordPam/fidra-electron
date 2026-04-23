---
name: add-ipc-channel
description: Add a typed IPC channel connecting Electron main process to the React renderer
user-invocable: true
allowed-tools: Read, Grep, Glob, Write, Edit
argument-hint: <channelName>
---

# Add IPC Channel

Create a fully typed IPC channel called `$ARGUMENTS` connecting the Electron main process to the renderer.

## Steps

### 1. Define the channel types

Edit `src/shared/ipc-types.ts` to add the new channel:

```ts
export interface $ARGUMENTSChannel {
  // Request types (renderer -> main)
  '$ARGUMENTS:getAll': { args: void; result: Item[] }
  '$ARGUMENTS:getById': { args: { id: string }; result: Item | null }
  '$ARGUMENTS:create': { args: NewItem; result: Item }
  '$ARGUMENTS:update': { args: { id: string; changes: Partial<Item> }; result: Item }
  '$ARGUMENTS:delete': { args: { id: string }; result: void }
}
```

Add the channel to the combined `IpcChannels` type in the same file.

### 2. Create the main process handler

Create or edit `src/main/ipc/$ARGUMENTS.ts`:

```ts
import { ipcMain } from 'electron'
// Import database/service dependencies

export function register$ARGUMENTSHandlers() {
  ipcMain.handle('$ARGUMENTS:getAll', async () => {
    // Call database layer
  })

  ipcMain.handle('$ARGUMENTS:create', async (_event, args) => {
    // Validate with Zod, then write to database
  })

  // ... other handlers
}
```

Register the handlers in `src/main/index.ts` during app startup.

### 3. Expose via preload

Edit `src/preload/index.ts` to expose the channel through `contextBridge`:

```ts
$ARGUMENTS: {
  getAll: () => ipcRenderer.invoke('$ARGUMENTS:getAll'),
  getById: (id: string) => ipcRenderer.invoke('$ARGUMENTS:getById', { id }),
  create: (data: NewItem) => ipcRenderer.invoke('$ARGUMENTS:create', data),
  update: (id: string, changes: Partial<Item>) =>
    ipcRenderer.invoke('$ARGUMENTS:update', { id, changes }),
  delete: (id: string) => ipcRenderer.invoke('$ARGUMENTS:delete', { id }),
},
```

### 4. Add to the window type

Edit `src/renderer/env.d.ts` (or wherever the `window.api` type is declared) to include the new channel's type so the renderer has full type safety.

### 5. IPC conventions

- **Channel names**: `entity:action` format (e.g., `transactions:getAll`, `sheets:create`)
- **Validation**: Always validate args with Zod in the main process handler before touching the database
- **Errors**: Let errors propagate — the renderer Zustand store catches them
- **No raw `ipcRenderer`** in renderer code — always go through the typed `window.api` object
- **Bulk operations**: Prefer a single `entity:bulkUpdate` channel over multiple individual calls for batch operations
- **Events from main to renderer**: Use `webContents.send()` for push notifications (e.g., sync updates, file changes). Register listeners in preload with `ipcRenderer.on()`.
