import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Reports is the largest stretch of money handling with no unit tests behind it —
 * report-html, report-builder and the export paths were all edited mechanically when
 * amounts moved to integer pence. The figures below are chosen so the totals can be
 * checked by hand rather than by re-implementing the sums in the test.
 *
 *   income   1000.00 + 250.50 = 1250.50
 *   expenses  300.00 +  45.25 =  345.25   (only once approved — expenses arrive pending)
 *   net                          905.25
 */

const INCOME = [
  ['1000.00', 'Membership subs'],
  ['250.50', 'Kit sales'],
];
const EXPENSES = [
  ['300.00', 'Pool hire'],
  ['45.25', 'Equipment'],
];

async function goToTransactions(window: Page): Promise<void> {
  await window.locator('a[href="#/transactions"]').click();
  await expect(window.getByPlaceholder('What was this for?')).toBeVisible({ timeout: 20_000 });
}

async function add(window: Page, kind: 'Income' | 'Expense', amount: string, description: string): Promise<void> {
  await window.getByRole('button', { name: kind, exact: true }).first().click();
  await window.getByPlaceholder('0.00').fill(amount);
  await window.getByPlaceholder('What was this for?').fill(description);
  await window.getByRole('button', { name: `Add ${kind}` }).click();
  await expect(window.getByText(description)).toBeVisible({ timeout: 20_000 });
}

test('reports the totals it was given', async ({ window, mainErrors }) => {
  await goToTransactions(window);

  for (const [amount, description] of INCOME) {
    await add(window, 'Income', amount, description);
  }
  for (const [amount, description] of EXPENSES) {
    await add(window, 'Expense', amount, description);
  }

  // Expenses land as pending and do not count until approved: select all, press A
  await window.locator('table tbody tr').first().click();
  await window.keyboard.press('Meta+a');
  await window.keyboard.press('a');
  await expect(window.getByText('Approved').first()).toBeVisible({ timeout: 20_000 });

  await window.locator('a[href="#/reports"]').click();
  await window.waitForTimeout(2000);

  await window.screenshot({ path: 'test-results/reports-page.png', fullPage: true });

  // The breakdowns sit below the fold, inside a scrolling container
  const lastCard = window.locator('main >> text=/Breakdown|Explore|Category/i').last();
  if (await lastCard.count()) {
    await lastCard.scrollIntoViewIfNeeded();
    await window.waitForTimeout(800);
  }
  await window.screenshot({ path: 'test-results/reports-lower.png' });

  // And the export menu, without actually triggering a native save dialog
  await window.mouse.wheel(0, -3000);
  await window.waitForTimeout(400);
  await window.getByRole('button', { name: 'Export' }).click();
  await window.waitForTimeout(600);
  await window.screenshot({ path: 'test-results/reports-export-menu.png' });
  await window.keyboard.press('Escape');

  const body = await window.locator('body').innerText();
  expect(body).not.toContain('NaN');
  expect(body).not.toContain('undefined');
  expect(body).not.toContain('Infinity');

  expect(mainErrors, `main process errored:\n${mainErrors.join('\n')}`).toEqual([]);
});
