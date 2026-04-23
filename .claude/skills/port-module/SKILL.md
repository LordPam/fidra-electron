---
name: port-module
description: Port a Python module from the original Fidra app to TypeScript for Fidra-Web
user-invocable: true
allowed-tools: Read, Grep, Glob, Write, Edit, Bash
argument-hint: <python-file-path>
---

# Port Module from Python to TypeScript

You are porting `$ARGUMENTS` from the original Fidra Python app to the Fidra-Web TypeScript codebase.

## Process

### Step 1: Read the Python source

Read the original file at `../Fidra/fidra/$ARGUMENTS`. Understand:
- What does this module do?
- What are its dependencies (imports from other Fidra modules)?
- What are the public interfaces (classes, functions, types)?

### Step 2: Check if dependencies are already ported

Use Glob and Grep to check whether the Python module's Fidra dependencies already exist in the TypeScript codebase. If critical dependencies haven't been ported yet, flag them and ask the user whether to port them first.

### Step 3: Map Python patterns to TypeScript equivalents

| Python | TypeScript |
|--------|-----------|
| `@dataclass(frozen=True)` | `readonly` interface + Zod schema |
| `Enum` | `as const` object or string union type |
| `Optional[str]` | `string \| null` |
| `Decimal` | `number` (use integers in pence/cents for money) |
| `UUID` | `string` (branded type: `type TransactionId = string & { __brand: 'TransactionId' }`) |
| `datetime` | `Date` or ISO string |
| `date` | `string` (YYYY-MM-DD format) |
| `async def` in repository | Sync function in main process (better-sqlite3 is synchronous) |
| `Signal/Observable` | Zustand store subscription |
| `asyncio.Queue` | IPC message passing |

### Step 4: Determine where the TypeScript file belongs

Follow the directory mapping from CLAUDE.md:

| Python location | TypeScript location |
|----------------|-------------------|
| `domain/models.py` | `src/renderer/domain/models.ts` |
| `domain/settings.py` | `src/renderer/domain/settings.ts` |
| `data/*.py` | `src/main/database/` |
| `services/*.py` | `src/renderer/services/` or `src/main/services/` depending on whether it needs filesystem/DB access |
| `state/*.py` | `src/renderer/stores/` |
| `ui/views/*.py` | `src/renderer/views/` |
| `ui/components/*.py` | `src/renderer/components/` |
| `ui/dialogs/*.py` | `src/renderer/dialogs/` |
| `ui/models/*.py` | Logic absorbed into Zustand stores or component hooks |

### Step 5: Write the TypeScript module

- Follow the coding conventions in CLAUDE.md
- Use named exports only
- Add Zod schemas for any data that crosses a boundary (IPC, database, user input)
- Do NOT add unnecessary comments or docstrings — let the types speak
- Keep the same function/method names where sensible for traceability back to Python

### Step 6: Update the migration tracker

After successfully porting, update the relevant checkbox in `CLAUDE.md` under the Migration Tracker section.

### Step 7: Report

Summarise what was ported, any design decisions made, and any dependencies that still need porting.
