import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  expandTemplate,
  createInstance,
  projectBalance,
  getOverdueDate,
  getDueTodayDate,
  getNextDueDate,
} from '../forecast';
import type { PlannedTemplateRow } from '../../../shared/ipc-types';

/** Every function here reads "today" from the clock, so it has to be pinned. */
const TODAY = '2026-06-15';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
});

afterEach(() => {
  vi.useRealTimers();
});

function template(overrides: Partial<PlannedTemplateRow> = {}): PlannedTemplateRow {
  return {
    id: 'pt-1',
    start_date: '2026-06-01',
    description: 'Monthly subs',
    amount: '10.00',
    type: 'income',
    frequency: 'monthly',
    target_sheet: 'Main',
    category: null,
    party: null,
    activity: null,
    notes: null,
    end_date: null,
    occurrence_count: null,
    skipped_dates: '[]',
    fulfilled_dates: '[]',
    transfer_target_sheet: null,
    version: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const dates = (t: PlannedTemplateRow, horizon: string, includePast = false): string[] =>
  expandTemplate(t, horizon, includePast).map((i) => i.instanceDate);

describe('expandTemplate', () => {
  it('expands each frequency', () => {
    expect(dates(template({ start_date: '2026-06-15', frequency: 'weekly' }), '2026-07-06'))
      .toEqual(['2026-06-15', '2026-06-22', '2026-06-29', '2026-07-06']);
    expect(dates(template({ start_date: '2026-06-15', frequency: 'biweekly' }), '2026-07-13'))
      .toEqual(['2026-06-15', '2026-06-29', '2026-07-13']);
    expect(dates(template({ start_date: '2026-06-15', frequency: 'monthly' }), '2026-08-15'))
      .toEqual(['2026-06-15', '2026-07-15', '2026-08-15']);
    expect(dates(template({ start_date: '2026-06-15', frequency: 'quarterly' }), '2026-12-15'))
      .toEqual(['2026-06-15', '2026-09-15', '2026-12-15']);
    expect(dates(template({ start_date: '2026-06-15', frequency: 'yearly' }), '2028-06-15'))
      .toEqual(['2026-06-15', '2027-06-15', '2028-06-15']);
  });

  it('yields a single instance for a one-off', () => {
    expect(dates(template({ start_date: '2026-06-20', frequency: 'once' }), '2027-01-01'))
      .toEqual(['2026-06-20']);
  });

  it('hides past occurrences unless asked for them', () => {
    const t = template({ start_date: '2026-04-15', frequency: 'monthly' });

    expect(dates(t, '2026-07-15')).toEqual(['2026-06-15', '2026-07-15']);
    expect(dates(t, '2026-07-15', true))
      .toEqual(['2026-04-15', '2026-05-15', '2026-06-15', '2026-07-15']);
  });

  it('omits skipped and fulfilled occurrences', () => {
    const t = template({
      start_date: '2026-06-15',
      frequency: 'monthly',
      skipped_dates: '["2026-07-15"]',
      fulfilled_dates: '["2026-08-15"]',
    });

    expect(dates(t, '2026-09-15')).toEqual(['2026-06-15', '2026-09-15']);
  });

  it('stops at end_date', () => {
    const t = template({ start_date: '2026-06-15', frequency: 'monthly', end_date: '2026-08-01' });

    expect(dates(t, '2026-12-15')).toEqual(['2026-06-15', '2026-07-15']);
  });

  it('stops after occurrence_count, counting fulfilled but not skipped ones', () => {
    expect(dates(template({ start_date: '2026-06-15', frequency: 'monthly', occurrence_count: 2 }), '2026-12-15'))
      .toEqual(['2026-06-15', '2026-07-15']);

    // A fulfilled occurrence still uses up one of the three
    expect(dates(template({
      start_date: '2026-06-15',
      frequency: 'monthly',
      occurrence_count: 3,
      fulfilled_dates: '["2026-06-15"]',
    }), '2026-12-15')).toEqual(['2026-07-15', '2026-08-15']);

    // A skipped one does not
    expect(dates(template({
      start_date: '2026-06-15',
      frequency: 'monthly',
      occurrence_count: 2,
      skipped_dates: '["2026-06-15"]',
    }), '2026-12-15')).toEqual(['2026-07-15', '2026-08-15']);
  });

  it('returns nothing when the horizon precedes the start', () => {
    expect(dates(template({ start_date: '2026-09-01' }), '2026-08-01')).toEqual([]);
  });

  it('drifts when a monthly template starts on a day the next month lacks', () => {
    // Recording current behaviour, not endorsing it. Date.setMonth rolls "31
    // February" over into 3 March, and every later occurrence then follows the 3rd
    // instead of the 31st — the series never recovers. A monthly template starting
    // on the 29th, 30th or 31st therefore slips permanently.
    expect(dates(template({ start_date: '2026-01-31', frequency: 'monthly' }), '2026-04-30', true))
      .toEqual(['2026-01-31', '2026-03-03', '2026-04-03']);
  });
});

describe('createInstance', () => {
  it('copies the template onto a planned transaction', () => {
    const instance = createInstance(
      template({ category: 'Subs', party: 'Members', activity: 'Season', notes: 'note' }),
      '2026-07-01',
    );

    expect(instance).toMatchObject({
      date: '2026-07-01',
      description: 'Monthly subs',
      amount: '10.00',
      type: 'income',
      status: 'planned',
      sheet: 'Main',
      category: 'Subs',
      party: 'Members',
      activity: 'Season',
      notes: 'note',
    });
  });

  it('gives the same occurrence the same id every time', () => {
    const t = template();
    expect(createInstance(t, '2026-07-01').id).toBe(createInstance(t, '2026-07-01').id);
    expect(createInstance(t, '2026-07-01').id).not.toBe(createInstance(t, '2026-08-01').id);
  });
});

describe('projectBalance', () => {
  it('applies income and expenses up to the target date only', () => {
    const instances = expandTemplate(template({ start_date: '2026-06-15', frequency: 'monthly' }), '2026-09-15');

    expect(projectBalance(100, instances, '2026-07-15')).toBe(120);
    expect(projectBalance(100, instances, '2026-09-15')).toBe(140);
  });

  it('subtracts expenses', () => {
    const instances = expandTemplate(
      template({ start_date: '2026-06-15', frequency: 'monthly', type: 'expense', amount: '25.50' }),
      '2026-07-15',
    );

    expect(projectBalance(100, instances, '2026-07-15')).toBe(49);
  });

  it('stays exact across many instances', () => {
    const instances = expandTemplate(
      template({ start_date: '2026-06-15', frequency: 'weekly', amount: '0.10' }),
      '2027-06-15',
    );

    expect(instances.length).toBeGreaterThan(50);
    const projected = projectBalance(0, instances, '2027-06-15');
    expect(projected).toBe(instances.length / 10);
  });
});

describe('due-date helpers', () => {
  it('reports the most recent missed occurrence', () => {
    expect(getOverdueDate(template({ start_date: '2026-04-15', frequency: 'monthly' })))
      .toBe('2026-05-15');
  });

  it('reports no overdue date when everything past is fulfilled', () => {
    expect(getOverdueDate(template({
      start_date: '2026-04-15',
      frequency: 'monthly',
      fulfilled_dates: '["2026-04-15","2026-05-15"]',
    }))).toBeNull();
  });

  it('recognises an occurrence due today', () => {
    expect(getDueTodayDate(template({ start_date: '2026-05-15', frequency: 'monthly' }))).toBe(TODAY);
    expect(getDueTodayDate(template({ start_date: '2026-05-16', frequency: 'monthly' }))).toBeNull();
  });

  it('does not count today as due once it is fulfilled or skipped', () => {
    const start = { start_date: '2026-05-15', frequency: 'monthly' as const };
    expect(getDueTodayDate(template({ ...start, fulfilled_dates: `["${TODAY}"]` }))).toBeNull();
    expect(getDueTodayDate(template({ ...start, skipped_dates: `["${TODAY}"]` }))).toBeNull();
  });

  it('finds the next due date, today included', () => {
    expect(getNextDueDate(template({ start_date: '2026-05-15', frequency: 'monthly' }))).toBe(TODAY);
    expect(getNextDueDate(template({ start_date: '2026-06-20', frequency: 'once' }))).toBe('2026-06-20');
  });

  it('returns null once a template is exhausted', () => {
    expect(getNextDueDate(template({ start_date: '2026-01-01', frequency: 'once' }))).toBeNull();
    expect(getNextDueDate(template({
      start_date: '2026-01-15',
      frequency: 'monthly',
      end_date: '2026-03-15',
    }))).toBeNull();
  });
});
