---
name: new-dialog
description: Create a modal dialog component following shadcn/ui Dialog patterns
user-invocable: true
allowed-tools: Read, Grep, Glob, Write, Edit
argument-hint: <DialogName>
---

# Create New Dialog

Scaffold a dialog called `$ARGUMENTS`.

## Steps

### 1. Create the dialog component

Create `src/renderer/dialogs/$ARGUMENTS.tsx` using the shadcn/ui Dialog primitive:

```tsx
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import { Button } from '../components/ui/button'

interface $ARGUMENTSProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Add domain-specific props
}

export function $ARGUMENTS({ open, onOpenChange }: $ARGUMENTSProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>DIALOG_TITLE</DialogTitle>
          <DialogDescription>DIALOG_DESCRIPTION</DialogDescription>
        </DialogHeader>

        {/* Dialog body */}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

### 2. Dialog conventions

- **Controlled**: Always use `open` + `onOpenChange` props (never internal state for visibility)
- **Validation**: Use Zod schemas + react-hook-form for form dialogs
- **Loading states**: Disable buttons and show spinner during async operations
- **Error display**: Show inline errors, not alerts
- **Size**: Use `DialogContent className="sm:max-w-[WIDTH]"` where WIDTH matches content needs:
  - Small (confirmation): `425px`
  - Medium (form): `550px`
  - Large (complex form): `700px`
  - Extra large (data table): `900px`

### 3. Cross-reference the Python original

Read the corresponding Python dialog at `../Fidra/fidra/ui/dialogs/` to understand fields, validation rules, and behaviour. Port the logic faithfully.

### 4. Form dialogs

For dialogs with forms, use this pattern:

```tsx
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

const formSchema = z.object({ /* fields */ })
type FormValues = z.infer<typeof formSchema>

// Inside component:
const form = useForm<FormValues>({
  resolver: zodResolver(formSchema),
  defaultValues: { /* ... */ },
})
```
