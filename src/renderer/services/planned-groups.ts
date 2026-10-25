import type { PlannedTemplateRow } from '../../shared/ipc-types';

export const UNASSIGNED_ACTIVITY = 'No activity';

export interface PlannedActivityGroup<T> {
  activity: string;
  items: T[];
}

/**
 * Planned templates are presented as activity-led groups. Named activities are
 * sorted alphabetically and the unassigned bucket stays at the end.
 */
export function groupPlannedByActivity<T>(
  items: T[],
  getTemplate: (item: T) => PlannedTemplateRow,
): PlannedActivityGroup<T>[] {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const activity = getTemplate(item).activity?.trim() || UNASSIGNED_ACTIVITY;
    const group = groups.get(activity);
    if (group) group.push(item);
    else groups.set(activity, [item]);
  }

  return Array.from(groups, ([activity, groupItems]) => ({ activity, items: groupItems }))
    .sort((a, b) => {
      if (a.activity === UNASSIGNED_ACTIVITY) return 1;
      if (b.activity === UNASSIGNED_ACTIVITY) return -1;
      return a.activity.localeCompare(b.activity, undefined, { sensitivity: 'base' });
    });
}

/** True when an edit applies to more than one linked planned occurrence. */
export function plannedGroupHasMultipleInstances(
  template: PlannedTemplateRow,
  visibleInstanceCount: number,
): boolean {
  if (visibleInstanceCount > 1) return true;
  if (template.frequency === 'once') return false;
  return template.occurrence_count !== 1;
}
