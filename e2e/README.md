# End-to-end tests

These launch the real Electron app — main process, preload, renderer, real SQLite —
and drive it the way a person would. They cover the wiring *between* parts, which is
where the bugs that reached users have actually lived. Unit tests in `src/**/__tests__`
cover logic; these cover the app.

```bash
npm run test:e2e      # rebuild for Electron, package, then run
npm test              # unit tests (rebuilds for Node first)
npm run test:all      # both, in the right order
```

## Three traps, all of which produce confidently wrong results

**1. Tests run against the last build, not your source.**
Playwright launches `.vite/build/index.js` via package.json `main`. Edit a file, run
the tests without rebuilding, and you are testing the old code — it will happily pass.
`npm run test:e2e` runs `npm run package` first for exactly this reason. If you run
`npx playwright test` directly, you are responsible for building first.

This was not hypothetical: while writing these, a test "passed" against a deliberately
broken build and only failed once the build was refreshed.

**2. better-sqlite3 can only be built for one runtime at a time.**
It is a native module. Vitest runs under Node; Electron ships its own ABI. Whichever
you built for last, the other suite fails — Vitest with ~100 errors mentioning
`db.pragma` or `loadExtension`, Electron with a module-version mismatch on launch.
The `test` and `test:e2e` scripts each rebuild for the runtime they need, so alternating
between them is safe as long as you use the scripts.

**3. Without sandboxing, tests open your real ledger.**
On launch the app opens `globalSettings.lastFile`. On a developer machine that is a
real database, and the tests would migrate and write to it. The fixture in
`fixtures.ts` redirects both `HOME` (which is where `~/.fidra` settings and
attachments resolve from) and `--user-data-dir` (where the default database lives)
into a temp directory that is deleted afterwards. **Any new test must use that
fixture.** `smoke.e2e.ts` asserts the sandbox is real before anything else runs.

## Writing tests

Each test gets a fresh install: no settings, no database, no sheets. The app creates
a "General" sheet on first run and lands on the Dashboard.

Address navigation links by href — `a[href="#/transactions"]` (the app uses
HashRouter) or by their `aria-label`. The visible label disappears when the sidebar
is collapsed, but the accessible name remains stable in both states.

Expansion also means a plain `getByText('Dashboard')` matches the nav label *and* the
view heading. Use `getByRole('heading', …)` when you mean the view.

`mainErrors` collects main-process stderr, so a test can assert the app did not log an
error while doing the thing under test — cheap and catches a lot.

## What these cannot tell you

That a layout is correct, a colour is readable, or a number is in the right column.
They assert on text and structure, not appearance. On failure Playwright writes a
screenshot and a trace to `test-results/`, which is usually enough to see what
happened:

```bash
npx playwright show-trace test-results/<test-name>/trace.zip
```

## Update checks

`updates.e2e.ts` covers persistent update controls, process-wide status, the manual-only preference, unfinished-transaction protection, invoice-save flushing, and reopening ledger windows after an update handoff. The tests inject status/preparation events and use only the fixture's temporary ledgers. They never download, install, or publish a release.
