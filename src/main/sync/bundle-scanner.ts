import fs from 'node:fs';
import path from 'node:path';
import { isBundleFile, parseBundleFilename } from './bundle-io';
import type { AppliedBundles } from './applied-bundles';
import { syncLog, errorMessage } from './sync-log';

export interface ScannedBundle {
  filePath: string;
  deviceId: string;
  sequenceNumber: number;
}

export function scanForNewBundles(
  syncFolder: string,
  ownDeviceId: string,
  appliedBundles: AppliedBundles,
): ScannedBundle[] {
  const syncDir = path.join(syncFolder, 'sync');

  let entries: string[];
  try {
    entries = fs.readdirSync(syncDir);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      // sync/ directory doesn't exist yet — nothing to scan
      return [];
    }
    // Real FS error (EACCES, EAGAIN, etc.) — surface it
    syncLog('error', 'scanForNewBundles failed to read sync dir', { syncDir, code, error: errorMessage(e) });
    throw e;
  }

  const results: ScannedBundle[] = [];

  for (const entry of entries) {
    if (!isBundleFile(entry)) continue;

    const parsed = parseBundleFilename(entry);
    if (!parsed) continue;

    // Skip our own bundles
    if (parsed.deviceId === ownDeviceId) continue;

    // Coarse pre-filter: skip if sequence number is at or below the latest applied
    const latestSeq = appliedBundles.getLatestSequence(parsed.deviceId);
    if (latestSeq !== null && parsed.sequenceNumber <= latestSeq) continue;

    results.push({
      filePath: path.join(syncDir, entry),
      deviceId: parsed.deviceId,
      sequenceNumber: parsed.sequenceNumber,
    });
  }

  // Sort by sequence number ascending so bundles are applied in order
  results.sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  return results;
}
