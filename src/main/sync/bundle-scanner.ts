import fs from 'node:fs';
import path from 'node:path';
import { isBundleFile, parseBundleFilename, readBundleFile } from './bundle-io';
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
    if (!parsed) throw new Error(`Unrecognised sync bundle filename needs review: ${entry}. It may be a provider conflict copy.`);

    // Skip our own bundles
    if (parsed.deviceId === ownDeviceId) continue;

    // A higher sequence can arrive first, or a lower one can have failed.
    if (appliedBundles.hasAppliedSequence(parsed.deviceId, parsed.sequenceNumber)) {
      appliedBundles.assertAppliedPayload(parsed.deviceId, parsed.sequenceNumber, readBundleFile(path.join(syncDir, entry)));
      continue;
    }

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
