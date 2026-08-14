import { test as base, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '..');

/**
 * A sandboxed launch of the real app.
 *
 * The isolation here is not a nicety. On startup the app opens
 * `globalSettings.lastFile`, which on a developer machine is a real ledger — so a
 * test launched without this would open, migrate and mutate actual financial data.
 * Two things have to be redirected to prevent that:
 *
 *   HOME              `~/.fidra` holds global settings and attachments, resolved
 *                     through `os.homedir()`, which honours $HOME on macOS/Linux.
 *   --user-data-dir   `getDefaultDbPath()` is `app.getPath('userData')/fidra.db`.
 *
 * Both are pointed at a per-test temp directory that is deleted afterwards, so each
 * test starts from a genuinely fresh install: no settings, no database, no sheets.
 */
export interface FidraFixtures {
  app: ElectronApplication;
  window: Page;
  /** The sandbox root, for tests that need to inspect files the app wrote. */
  userHome: string;
  /** Anything the main process printed to stderr, for asserting a clean boot. */
  mainErrors: string[];
}

export const test = base.extend<FidraFixtures>({
  userHome: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-e2e-'));
    await use(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  },

  mainErrors: async ({}, use) => {
    await use([]);
  },

  app: async ({ userHome, mainErrors }, use) => {
    const userDataDir = path.join(userHome, 'userData');
    fs.mkdirSync(userDataDir, { recursive: true });

    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: userHome,
        USERPROFILE: userHome,
        // Suppress the update check so tests never hit the network
        FIDRA_E2E: '1',
      },
    });

    app.process().stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString();
      // Electron/Chromium chatter that appears on every launch and means nothing
      if (/ERROR:.*cache|DevTools|Vulkan|GPU stall|sandbox/i.test(line)) return;
      mainErrors.push(line.trim());
    });

    await use(app);
    await app.close().catch(() => { /* already gone */ });
  },

  window: async ({ app }, use) => {
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    // The renderer boots its stores over IPC; wait for the shell to be interactive
    // rather than racing the first paint.
    await window.waitForSelector('body', { state: 'attached' });
    await use(window);
  },
});

export const expect = test.expect;

/** Assert the sandbox really is a sandbox. Called by the guard test. */
export function assertSandboxed(userHome: string): void {
  const realHome = os.homedir();
  if (userHome === realHome || userHome.startsWith(path.join(realHome, '.fidra'))) {
    throw new Error(`E2E sandbox escaped into the real home directory: ${userHome}`);
  }
}
