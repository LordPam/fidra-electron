import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Restoring a backup is the path with the least prior evidence behind it.
 *
 * `backup:restore` closes the database, swaps the file, and then has to rebuild the
 * window's context. It used to do that by calling `switchWindowToFile(id, ctx.dbPath)`,
 * which returns early when the path has not changed — so after every restore the
 * window kept a **closed** SQLite handle and each later action threw. That was found
 * by reading the code and fixed with `reopenWindowDatabase`, but the fix had never
 * run in a real window until this test.
 *
 * The assertion that matters is the last one: the app must still work afterwards.
 */

async function goToTransactions(window: Page): Promise<void> {
  await window.locator('a[href="#/transactions"]').click();
  await expect(window.getByPlaceholder('What was this for?')).toBeVisible({ timeout: 20_000 });
}

async function addExpense(window: Page, amount: string, description: string): Promise<void> {
  await window.getByPlaceholder('0.00').fill(amount);
  await window.getByPlaceholder('What was this for?').fill(description);
  await window.getByRole('button', { name: /^Add (Expense|Income)$/ }).click();
  await expect(window.getByText(description)).toBeVisible({ timeout: 20_000 });
}

async function openBackupDialog(window: Page): Promise<void> {
  await window.locator('a[href="#/settings"]').click();
  await window.getByRole('button', { name: 'Manage Backups' }).click();
  await expect(window.getByRole('button', { name: 'Create Backup Now' })).toBeVisible({ timeout: 20_000 });
}

test('restores a backup and leaves the app usable', async ({ window, mainErrors }) => {
  // 1. Something worth keeping
  await goToTransactions(window);
  await addExpense(window, '10.00', 'Present in the backup');

  // 2. Take the backup
  await openBackupDialog(window);
  await window.getByRole('button', { name: 'Create Backup Now' }).click();
  await expect(window.getByRole('button', { name: 'Restore' })).toBeVisible({ timeout: 30_000 });

  // 3. Diverge from it
  await window.keyboard.press('Escape');
  await goToTransactions(window);
  await addExpense(window, '99.00', 'Added after the backup');

  // 4. Restore
  await openBackupDialog(window);
  await window.getByRole('button', { name: 'Restore' }).first().click();
  await window.getByRole('button', { name: 'Confirm' }).click();

  // The restore reloads the renderer, so wait for the app to come back up
  await window.waitForLoadState('domcontentloaded');
  await expect(window.locator('a[href="#/transactions"]')).toBeVisible({ timeout: 30_000 });

  // 5. The backup's contents won, and the later change is gone
  await goToTransactions(window);
  await expect(window.getByText('Present in the backup')).toBeVisible({ timeout: 20_000 });
  await expect(window.getByText('Added after the backup')).toHaveCount(0);

  // 6. The point of the test: the window still has a live database. Before the fix
  // this threw, because the connection had been closed and never reopened.
  await addExpense(window, '5.00', 'Saved after the restore');

  expect(mainErrors, `main process errored:\n${mainErrors.join('\n')}`).toEqual([]);
});
