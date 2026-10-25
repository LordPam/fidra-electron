import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function goToPlanned(window: Page): Promise<void> {
  await window.locator('a[href="#/planned"]').click();
  await expect(window.getByRole('heading', { name: 'Planned' })).toBeVisible({ timeout: 20_000 });
}

async function addPlanned(
  window: Page,
  description: string,
  activity: string,
  frequency: 'Once' | 'Monthly' = 'Once',
): Promise<void> {
  await window.getByRole('button', { name: 'Add Planned', exact: true }).click();
  const dialog = window.getByRole('dialog', { name: 'Add Planned Transaction' });
  await dialog.getByPlaceholder('0.00').fill('25.00');
  await dialog.getByPlaceholder('Description').fill(description);
  await dialog.getByPlaceholder('Activity').fill(activity);

  if (frequency !== 'Once') {
    await dialog.getByRole('combobox').last().click();
    await window.getByRole('option', { name: frequency }).click();
  }

  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(window.getByRole('dialog', { name: 'Add Planned Transaction' })).toHaveCount(0);
  await expect(window.getByText(description)).toBeVisible({ timeout: 20_000 });
}

test('groups planned transactions by activity and bulk edits selected groups', async ({ window }) => {
  await goToPlanned(window);
  await addPlanned(window, 'Coach hire', 'Winter trip');
  await addPlanned(window, 'Hotel deposit', 'Winter trip');
  await addPlanned(window, 'Dinner venue', 'Annual dinner');

  await expect(window.locator('tr[data-activity-group="Annual dinner"]')).toBeVisible();
  await expect(window.locator('tr[data-activity-group="Winter trip"]')).toBeVisible();

  const coachRow = window.locator('tr').filter({ hasText: 'Coach hire' });
  const hotelRow = window.locator('tr').filter({ hasText: 'Hotel deposit' });
  await coachRow.click();
  // Control-click is the native context-menu gesture on macOS; use the platform
  // multi-select modifier here. Ctrl keyboard shortcuts are covered below.
  await hotelRow.click({ modifiers: ['Meta'] });
  await expect(window.getByRole('button', { name: 'Edit 2 Groups' })).toBeVisible();

  await window.keyboard.press('e');
  const bulkDialog = window.getByRole('dialog', { name: /Bulk Edit \(2 planned groups\)/ });
  await expect(bulkDialog).toBeVisible();
  await bulkDialog.getByLabel('Change description').click();
  await bulkDialog.getByLabel('New description').fill('Winter trip booking');
  await bulkDialog.getByLabel('Change amount').click();
  await bulkDialog.getByLabel('New amount').fill('30.50');
  await bulkDialog.getByLabel('Change notes').click();
  await bulkDialog.getByLabel('New notes').fill('Updated together');
  await bulkDialog.getByRole('button', { name: 'Apply Changes' }).click();

  const updatedRows = window.locator('tr').filter({ hasText: 'Winter trip booking' });
  await expect(updatedRows).toHaveCount(2);
  await expect(updatedRows.nth(0)).toContainText('30.50');
  await expect(updatedRows.nth(1)).toContainText('30.50');
});

test('modifier shortcuts duplicate and delete planned groups', async ({ window }) => {
  await goToPlanned(window);
  await addPlanned(window, 'Single booking', 'Training');

  await window.locator('tr').filter({ hasText: 'Single booking' }).click();
  await window.keyboard.press('Control+d');
  const bookingRows = window.locator('tr').filter({ hasText: 'Single booking' });
  await expect(bookingRows).toHaveCount(2);

  await window.keyboard.press('Control+Delete');
  await expect(bookingRows).toHaveCount(1);
});

test('instance shortcuts warn before acting on the linked recurring group', async ({ window }) => {
  await goToPlanned(window);
  await addPlanned(window, 'Monthly storage', 'Equipment', 'Monthly');

  const groupRow = window.locator('tr').filter({ hasText: 'Monthly storage' }).first();
  await groupRow.locator('td').first().click();
  const instance = window.locator('tr[data-planned-instance]').first();
  await expect(instance).toBeVisible();
  await instance.click();

  await window.keyboard.press('Control+d');
  const duplicateWarning = window.getByTestId('planned-group-warning');
  await expect(duplicateWarning).toContainText('Duplicate the whole planned group?');
  await expect(duplicateWarning).toContainText('all its linked occurrences');
  await duplicateWarning.getByRole('button', { name: 'Cancel' }).click();

  await window.keyboard.press('Control+Delete');
  const deleteWarning = window.getByTestId('planned-group-warning');
  await expect(deleteWarning).toContainText('Delete the whole planned group?');
  await deleteWarning.getByRole('button', { name: 'Cancel' }).click();

  await groupRow.dblclick();
  await expect(window.getByRole('alert')).toContainText('propagate to every occurrence');
});
