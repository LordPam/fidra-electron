---
name: add-test
description: Scaffold a Vitest unit test or Playwright E2E test for a module or component
user-invocable: true
allowed-tools: Read, Grep, Glob, Write, Edit, Bash
argument-hint: <module-path>
---

# Add Test

Create tests for `$ARGUMENTS`.

## Steps

### 1. Determine test type

Based on the module path, choose the appropriate test type:

| Module location | Test type | Test location |
|----------------|-----------|---------------|
| `src/renderer/domain/` | Vitest unit | `tests/unit/domain/` |
| `src/renderer/services/` | Vitest unit | `tests/unit/services/` |
| `src/renderer/stores/` | Vitest unit | `tests/unit/stores/` |
| `src/main/database/` | Vitest integration | `tests/integration/database/` |
| `src/renderer/components/` | Vitest + Testing Library | `tests/unit/components/` |
| `src/renderer/views/` | Playwright E2E | `tests/e2e/` |
| `src/renderer/dialogs/` | Vitest + Testing Library | `tests/unit/dialogs/` |

### 2. Read the source module

Read `$ARGUMENTS` to understand:
- What functions/components are exported?
- What are the inputs, outputs, and edge cases?
- What external dependencies need mocking?

### 3. Scaffold Vitest unit test

Create the test file mirroring the source path:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('ModuleName', () => {
  beforeEach(() => {
    // Reset state between tests
  })

  it('should handle the primary use case', () => {
    // Arrange
    // Act
    // Assert
  })

  it('should handle edge case', () => {
    // ...
  })

  it('should reject invalid input', () => {
    expect(() => /* ... */).toThrow()
  })
})
```

### 4. Scaffold component test (Vitest + Testing Library)

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

describe('ComponentName', () => {
  it('should render with default props', () => {
    render(<Component items={[]} />)
    expect(screen.getByText('Expected text')).toBeInTheDocument()
  })

  it('should call onSelect when row is clicked', () => {
    const onSelect = vi.fn()
    render(<Component items={mockItems} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('Item 1'))
    expect(onSelect).toHaveBeenCalledWith('item-1-id')
  })
})
```

### 5. Scaffold Playwright E2E test

```ts
import { test, expect } from '@playwright/test'

test.describe('ViewName', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the view
    // Seed test data if needed
  })

  test('should display the expected content', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Title' })).toBeVisible()
  })

  test('should handle user interaction', async ({ page }) => {
    await page.getByRole('button', { name: 'Add' }).click()
    // Assert dialog opens, form works, etc.
  })
})
```

### 6. Testing conventions

- **File naming**: `module-name.test.ts` (unit) or `view-name.spec.ts` (E2E)
- **No snapshot tests**: They're brittle and hard to review. Test behaviour, not markup.
- **Mock IPC at the boundary**: For renderer tests, mock `window.api` methods. Never mock Zustand internals.
- **Test data factories**: Create helper functions that produce valid test objects:
  ```ts
  function makeTransaction(overrides?: Partial<Transaction>): Transaction {
    return { id: crypto.randomUUID(), date: '2026-01-15', description: 'Test', amount: 1000, ...overrides }
  }
  ```
- **Arrange-Act-Assert**: Every test follows this structure. One assertion per behaviour (multiple `expect` calls are fine if they assert one logical thing).
- **Run tests**: `npx vitest run` for unit, `npx playwright test` for E2E

### 7. What to test

Focus testing effort on:
- Business logic (balance calculations, forecast generation, search filtering)
- Data transformations (currency formatting, date handling, CSV export)
- Validation schemas (Zod schemas should reject bad data)
- User interactions in complex components (table selection, form submission)

Don't bother testing:
- Simple presentational components with no logic
- Direct Zustand store wiring (tested indirectly via component tests)
- Drizzle queries (tested via integration tests against a real SQLite file)
