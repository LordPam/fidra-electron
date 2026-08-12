---
name: add-db-table
description: Add a Drizzle ORM schema table with migration and IPC channel for a domain entity
user-invocable: true
allowed-tools: Read, Grep, Glob, Write, Edit, Bash
argument-hint: <tableName>
---

# Add Database Table

Create a new Drizzle schema table called `$ARGUMENTS` with migration and full IPC wiring.

## Steps

### 1. Cross-reference the Python schema

Read `../Fidra/fidra/data/sqlite_repo.py` to find the original SQLite CREATE TABLE statement or column definitions for this entity. Match the schema faithfully.

### 2. Define the Drizzle schema

Edit `src/main/database/schema.ts` to add the table:

```ts
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

export const $ARGUMENTS = sqliteTable('$ARGUMENTS', {
  id: text('id').primaryKey(),          // UUID as text
  // Map Python types:
  // str          -> text('col')
  // int          -> integer('col')
  // Decimal      -> integer('col')     (store as pence/cents)
  // bool         -> integer('col', { mode: 'boolean' })
  // date         -> text('col')        (YYYY-MM-DD)
  // datetime     -> text('col')        (ISO 8601)
  // Optional[X]  -> add .notNull() only if NOT optional
  // Enum         -> text('col')        (store enum value string)
  createdAt: text('created_at').notNull(),
  modifiedAt: text('modified_at'),
})
```

### 3. Money handling

The Python app uses `Decimal`. In the TypeScript app:
- **Store money as integers** (pence/cents) in the database to avoid floating-point issues
- Convert to display format only at the UI boundary
- Column type: `integer('amount')` not `real('amount')`
- The Python `amount` field represents pounds/euros — multiply by 100 when writing, divide by 100 when reading

### 4. Generate migration

Run Drizzle Kit to generate the migration:

```bash
npx drizzle-kit generate
```

Then apply it:

```bash
npx drizzle-kit migrate
```

If Drizzle Kit is not yet set up, add the migration SQL manually to `src/main/database/migrations/`.

### 5. Create repository functions

Create `src/main/database/$ARGUMENTS-repo.ts`:

```ts
import { db } from './connection'
import { $ARGUMENTS } from './schema'
import { eq } from 'drizzle-orm'

export function getAll$ARGUMENTS() {
  return db.select().from($ARGUMENTS).all()
}

export function get$ARGUMENTSById(id: string) {
  return db.select().from($ARGUMENTS).where(eq($ARGUMENTS.id, id)).get()
}

export function create$ARGUMENTS(data: New$ARGUMENTS) {
  return db.insert($ARGUMENTS).values(data).returning().get()
}

export function update$ARGUMENTS(id: string, changes: Partial<$ARGUMENTS>) {
  return db.update($ARGUMENTS).set(changes).where(eq($ARGUMENTS.id, id)).returning().get()
}

export function delete$ARGUMENTS(id: string) {
  return db.delete($ARGUMENTS).where(eq($ARGUMENTS.id, id)).run()
}
```

### 6. Wire up IPC

Use the `/add-ipc-channel` skill to create the IPC channel connecting these repository functions to the renderer. The IPC handlers should:
- Validate incoming data with Zod
- Call the repository functions
- Return results to the renderer

### 7. Database conventions

- **UUIDs**: Generate with `crypto.randomUUID()` in the main process
- **Timestamps**: Store as ISO 8601 strings, generate with `new Date().toISOString()`
- **Versioning**: Include a `version` integer column for optimistic concurrency (increment on every update)
- **Soft delete**: Do NOT add soft delete unless the Python app uses it — Fidra uses hard deletes with audit logging
- **Indexes**: Add indexes on columns used for filtering (sheet, category, date, activity)
