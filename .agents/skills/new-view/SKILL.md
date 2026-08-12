---
name: new-view
description: Scaffold a new top-level view page with route, sidebar entry, and Zustand wiring
user-invocable: true
allowed-tools: Read, Grep, Glob, Write, Edit
argument-hint: <ViewName>
---

# Create New View

Scaffold a new top-level view called `$ARGUMENTS`.

## Steps

### 1. Create the view component

Create `src/renderer/views/$ARGUMENTS.tsx`:

```tsx
import { /* relevant hooks */ } from '../hooks'

export function $ARGUMENTS() {
  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between px-6 py-4 border-b">
        <h1 className="text-2xl font-semibold">VIEW_TITLE</h1>
        {/* Action buttons */}
      </header>
      <main className="flex-1 overflow-auto p-6">
        {/* View content */}
      </main>
    </div>
  )
}
```

### 2. Add the route

Edit `src/renderer/App.tsx` to add a route for this view. Follow the existing pattern.

### 3. Add sidebar entry

Edit the sidebar/navigation component to include a link to this view. Use a Lucide icon consistent with the view's purpose.

### 4. Cross-reference the Python original

Read the corresponding Python view at `../Fidra/fidra/ui/views/` to understand what data, state, and actions the view needs. Wire up the appropriate Zustand stores.

### 5. Layout conventions

- Views fill the full content area (`h-full flex flex-col`)
- Header with title + action buttons, separated by `border-b`
- Scrollable main content area (`flex-1 overflow-auto`)
- Use `p-6` for content padding
- Responsive: single column on small screens, multi-panel on wide
