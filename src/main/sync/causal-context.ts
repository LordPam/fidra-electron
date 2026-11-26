import { z } from 'zod';

const sequence = z.number().int().min(1).max(9_999_999_999);
const rangesSchema = z.array(z.tuple([sequence, sequence])).max(10_000).refine((ranges) =>
  ranges.every(([start, end], index) => start <= end && (index === 0 || start > ranges[index - 1][1])),
{ message: 'Causal ranges must be ordered and disjoint' });
export const causalContextSchema = z.record(z.string().min(1).max(200), rangesSchema)
  .refine((context) => Object.keys(context).length <= 200, 'Too many devices in causal context');
export type CausalContext = Record<string, [number, number][]>;

export const causalStateSchema = z.object({
  bundles: z.array(z.object({ deviceId: z.string().min(1).max(200), sequenceNumber: sequence,
    observed: causalContextSchema, accepted: z.boolean() }).strict()),
  revisions: z.array(z.object({
    tableName: z.string().min(1).max(64), pkHex: z.string().regex(/^(?:[a-f0-9]{2})+$/), cid: z.string().min(1),
    siteHex: z.string().regex(/^[a-f0-9]{32}$/), colVersion: z.number().int().nonnegative(),
    causalLength: z.number().int().nonnegative(), seq: z.number().int().nonnegative(),
    valueHash: z.string().regex(/^[a-f0-9]{64}$/), sourceDevice: z.string().min(1).max(200), sourceSequence: sequence,
  }).strict()),
}).strict();
export type CausalState = z.infer<typeof causalStateSchema>;

/** Snapshot coverage must be derived from its exact accepted history records. */
export function assertSnapshotCausalContext(state: CausalState, observed: CausalContext): void {
  const accepted: CausalContext = Object.create(null) as CausalContext;
  const bundleKeys = new Set<string>();
  for (const bundle of state.bundles) {
    const key = JSON.stringify([bundle.deviceId, bundle.sequenceNumber]);
    if (bundleKeys.has(key)) throw new Error('Snapshot repeats a bundle identity. Reviewed recovery is required.');
    bundleKeys.add(key);
    if (bundle.accepted) {
      const ranges = accepted[bundle.deviceId] ??= [];
      ranges.push([bundle.sequenceNumber, bundle.sequenceNumber]);
    }
  }
  for (const [device, ranges] of Object.entries(accepted)) {
    ranges.sort(([a], [b]) => a - b);
    const merged: [number, number][] = [];
    for (const range of ranges) {
      const last = merged[merged.length - 1];
      if (last && range[0] === last[1] + 1) last[1] = range[1];
      else merged.push([...range]);
    }
    accepted[device] = merged;
  }
  if (!contextCovers(accepted, observed) || !contextCovers(observed, accepted)) {
    throw new Error('Snapshot observed coverage disagrees with its accepted history. Reviewed recovery is required.');
  }
  const revisionKeys = new Set<string>();
  for (const row of state.revisions) {
    if (!bundleKeys.has(JSON.stringify([row.sourceDevice, row.sourceSequence]))) throw new Error('Snapshot revision has no source history.');
    const key = JSON.stringify([row.tableName, row.pkHex, row.cid, row.siteHex, row.colVersion,
      row.causalLength, row.seq, row.valueHash]);
    if (revisionKeys.has(key)) throw new Error('Snapshot repeats revision provenance. Reviewed recovery is required.');
    revisionKeys.add(key);
  }
}

export function contextCovers(context: CausalContext, other: CausalContext): boolean {
  return Object.entries(other).every(([device, ranges]) => ranges.every(([start, end]) =>
    Object.hasOwn(context, device) && context[device].some(([left, right]) => left <= start && right >= end)));
}

export function canonicalContext(context: CausalContext): string {
  return JSON.stringify(Object.fromEntries(Object.entries(context).sort(([a], [b]) => a.localeCompare(b))));
}

export function contextIncludes(context: CausalContext, device: string, sequenceNumber: number): boolean {
  return Object.hasOwn(context, device)
    && context[device].some(([start, end]) => sequenceNumber >= start && sequenceNumber <= end);
}
