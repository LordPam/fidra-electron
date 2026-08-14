import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Saving a transaction is the path this session changed most and could least
 * verify: it runs Zod value validation (6e), the sheet-exists referential guard
 * (6f), and the integer-pence money conversion (6d), then comes back through the
 * balance calculation. All three were new sources of a hard failure, and none had
 * ever been exercised against a running app.
 */

async function goToTransactions(window: Page): Promise<void> {
  // Nav items are icon-only links with no accessible name, so they have to be
  // addressed by href — see the note in e2e/README.md.
  await window.locator('a[href="#/transactions"]').click();
  await expect(window.getByPlaceholder('What was this for?')).toBeVisible({ timeout: 20_000 });
}

async function addExpense(window: Page, amount: string, description: string): Promise<void> {
  await window.getByPlaceholder('0.00').fill(amount);
  await window.getByPlaceholder('What was this for?').fill(description);
  await window.getByRole('button', { name: /^Add (Expense|Income)$/ }).click();
}

test('saves a transaction and reflects it in the balance', async ({ window, mainErrors }) => {
  await goToTransactions(window);

  await addExpense(window, '42.50', 'Playwright kit purchase');

  // It reached the database and came back out
  await expect(window.getByText('Playwright kit purchase')).toBeVisible({ timeout: 20_000 });

  // And the money survived the round trip through integer pence
  await expect(window.getByText('42.50').first()).toBeVisible();

  expect(mainErrors, `main process errored:\n${mainErrors.join('\n')}`).toEqual([]);
});

test('saves several transactions in a row and renders no broken values', async ({ window }) => {
  await goToTransactions(window);

  for (const [amount, description] of [
    ['0.10', 'Small one'],
    ['0.20', 'Small two'],
    ['1234.56', 'Large one'],
  ]) {
    await addExpense(window, amount, description);
    await expect(window.getByText(description)).toBeVisible({ timeout: 20_000 });
  }

  // Deliberately NOT claiming to prove exact arithmetic: every amount on screen
  // goes through formatCurrency, which rounds to 2dp, so drift would be invisible
  // here whether or not it existed. Exactness is proven in money.test.ts and
  // balance.test.ts. What this catches is the visible failure mode — a formatter
  // or conversion that produces NaN, undefined, or a raw unformatted number.
  const body = await window.locator('body').innerText();
  expect(body).not.toContain('NaN');
  expect(body).not.toContain('undefined');
  expect(body).not.toContain('£0.00 £0.00 £0.00');
});

test('refuses an amount it cannot read instead of storing zero', async ({ window }) => {
  await goToTransactions(window);

  await window.getByPlaceholder('0.00').fill('not a number');
  await window.getByPlaceholder('What was this for?').fill('Should not save');
  await window.getByRole('button', { name: /^Add (Expense|Income)$/ }).click();

  // Previously `parseFloat(x) || 0` would have quietly booked this as £0.00
  await expect(window.getByText('Should not save')).toHaveCount(0);
});
