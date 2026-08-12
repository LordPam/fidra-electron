---
name: new-component
description: Scaffold a reusable React component with typed props and Tailwind styling
user-invocable: true
allowed-tools: Read, Grep, Glob, Write, Edit
argument-hint: <ComponentName>
---

# Create Reusable Component

Scaffold a reusable component called `$ARGUMENTS`.

## Steps

### 1. Create the component file

Create `src/renderer/components/$ARGUMENTS.tsx`:

```tsx
interface $ARGUMENTSProps {
  // Define props
  className?: string
}

export function $ARGUMENTS({ className }: $ARGUMENTSProps) {
  return (
    <div className={cn('', className)}>
      {/* Component content */}
    </div>
  )
}
```

### 2. Component conventions

- **Props interface**: Always define and export the props interface as `${ComponentName}Props`
- **className passthrough**: Accept optional `className` and merge with `cn()` (from shadcn/ui utils) so consumers can override/extend styles
- **Composition over configuration**: Prefer composable sub-components over prop-driven variants for complex components:
  ```tsx
  // Good
  <TransactionTable>
    <TransactionTable.Header />
    <TransactionTable.Body items={items} />
    <TransactionTable.Pagination />
  </TransactionTable>

  // Avoid for complex cases
  <TransactionTable showHeader showPagination items={items} />
  ```
- **No internal data fetching**: Components receive data via props or Zustand selectors. They never call IPC directly.
- **Event callbacks**: Use `on` prefix: `onSelect`, `onChange`, `onDelete`
- **Forwarded refs**: Use `forwardRef` only when the component wraps a native element that consumers need to access (inputs, scrollable containers)

### 3. Styling conventions

- Use Tailwind utility classes exclusively — no CSS files per component
- Use `cn()` for conditional classes:
  ```tsx
  className={cn(
    'rounded-md border px-3 py-2',
    isActive && 'border-primary bg-primary/10',
    isDisabled && 'opacity-50 cursor-not-allowed'
  )}
  ```
- Respect dark mode: use Tailwind's `dark:` prefix where needed, but prefer semantic tokens from shadcn/ui (`bg-background`, `text-foreground`, `border-border`) which handle dark mode automatically
- Spacing: use consistent padding/margin (`p-4`, `gap-3`, etc.)

### 4. Cross-reference the Python original

Check `../Fidra/fidra/ui/components/` for the corresponding Python widget. Understand:
- What data does it display?
- What user interactions does it handle?
- What signals/events does it emit?

Port the behaviour, not the implementation. The React version should feel native to the web.

### 5. Accessibility

- Interactive elements must be keyboard-accessible
- Use semantic HTML (`button`, `table`, `nav`, not `div` with onClick)
- Include `aria-label` on icon-only buttons
- shadcn/ui primitives handle most a11y — use them as the base
