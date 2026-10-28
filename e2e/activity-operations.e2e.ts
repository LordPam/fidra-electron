import { test, expect } from './fixtures';

test('activity rename and native Undo/Redo preserve entries, schedules and notes together', async ({ window, mainErrors }) => {
  await window.evaluate(async () => {
    await window.api.saveTransaction({ id: 'activity-entry', date: '2026-10-26', description: 'Activity expense', amount: '12.00', type: 'expense', status: 'pending', sheet: 'General', category: null, party: null, reference: null, activity: 'Synthetic trip', notes: null, linked_id: null, version: 1, created_at: '2026-10-26T00:00:00Z', modified_at: null, modified_by: null });
    await window.api.savePlannedTemplate({ id: 'activity-plan', start_date: '2026-10-26', description: 'Activity plan', amount: '12.00', type: 'expense', frequency: 'monthly', target_sheet: 'General', category: null, party: null, activity: 'Synthetic trip', notes: null, end_date: null, occurrence_count: null, skipped_dates: '[]', fulfilled_dates: '[]', transfer_target_sheet: null, version: 1, created_at: '2026-10-26T00:00:00Z' });
    await window.api.saveActivityNote('Synthetic trip', 'Keep this note');
  });
  await window.locator('a[href="#/activities"]').click();
  const row = window.locator('[data-activity="Synthetic trip"]');
  await row.click({ button: 'right' });
  await window.getByRole('menuitem', { name: 'Rename' }).click();
  await row.locator('input').fill('Synthetic outing');
  await row.locator('input').press('Enter');
  await expect(window.locator('[data-activity="Synthetic outing"]')).toBeVisible();
  async function snapshot() {
    return window.evaluate(async () => ({ transactions: await window.api.getTransactions(), plans: await window.api.getPlannedTemplates(), notes: await window.api.getActivityNotes() }));
  }
  expect(await snapshot()).toMatchObject({ transactions: [{ activity: 'Synthetic outing' }], plans: [{ activity: 'Synthetic outing' }], notes: { 'Synthetic outing': 'Keep this note' } });
  await window.keyboard.press('Meta+z');
  await expect(window.locator('[data-activity="Synthetic trip"]')).toBeVisible();
  expect(await snapshot()).toMatchObject({ transactions: [{ activity: 'Synthetic trip' }], plans: [{ activity: 'Synthetic trip' }], notes: { 'Synthetic trip': 'Keep this note' } });
  await window.keyboard.press('Meta+Shift+z');
  await expect(window.locator('[data-activity="Synthetic outing"]')).toBeVisible();
  expect(await snapshot()).toMatchObject({ transactions: [{ activity: 'Synthetic outing' }], plans: [{ activity: 'Synthetic outing' }], notes: { 'Synthetic outing': 'Keep this note' } });
  expect(mainErrors).toEqual([]);
});
