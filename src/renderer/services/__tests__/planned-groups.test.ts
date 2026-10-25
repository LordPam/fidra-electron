import { describe, expect, it } from 'vitest';
import type { PlannedTemplateRow } from '../../../shared/ipc-types';
import {
  groupPlannedByActivity,
  plannedGroupHasMultipleInstances,
  UNASSIGNED_ACTIVITY,
} from '../planned-groups';

function template(overrides: Partial<PlannedTemplateRow>): PlannedTemplateRow {
  return {
    id: crypto.randomUUID(),
    start_date: '2026-10-01',
    description: 'Planned item',
    amount: '10.00',
    type: 'expense',
    frequency: 'once',
    target_sheet: 'General',
    category: null,
    party: null,
    activity: null,
    notes: null,
    transfer_target_sheet: null,
    end_date: null,
    occurrence_count: null,
    skipped_dates: '[]',
    fulfilled_dates: '[]',
    version: 1,
    created_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('planned activity grouping', () => {
  it('groups named activities alphabetically and leaves unassigned last', () => {
    const items = [
      template({ activity: null, description: 'Loose' }),
      template({ activity: 'Winter trip', description: 'Coach' }),
      template({ activity: 'Annual dinner', description: 'Venue' }),
      template({ activity: 'Winter trip', description: 'Hotel' }),
    ];

    const groups = groupPlannedByActivity(items, (item) => item);

    expect(groups.map((group) => group.activity)).toEqual([
      'Annual dinner',
      'Winter trip',
      UNASSIGNED_ACTIVITY,
    ]);
    expect(groups[1].items.map((item) => item.description)).toEqual(['Coach', 'Hotel']);
  });
});

describe('planned multi-instance warnings', () => {
  it('warns for recurring groups unless explicitly limited to one occurrence', () => {
    expect(plannedGroupHasMultipleInstances(template({ frequency: 'monthly' }), 1)).toBe(true);
    expect(plannedGroupHasMultipleInstances(template({ frequency: 'monthly', occurrence_count: 1 }), 1)).toBe(false);
    expect(plannedGroupHasMultipleInstances(template({ frequency: 'once' }), 2)).toBe(true);
  });
});
