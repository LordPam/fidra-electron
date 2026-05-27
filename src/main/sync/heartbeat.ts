/**
 * Heartbeat probe for detecting stalled OneDrive sync.
 *
 * Each device periodically writes a small heartbeat file to the shared folder.
 * Peer heartbeat staleness indicates OneDrive has stopped propagating files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { syncLog, errorMessage } from './sync-log';

interface HeartbeatPayload {
  deviceId: string;
  timestamp: string;
}

export interface PeerHeartbeat {
  deviceId: string;
  timestamp: string;
  /** Age in milliseconds based on the timestamp in the file. */
  ageMs: number;
}

export interface StalenessResult {
  /** Whether any peer heartbeat files exist. */
  hasPeers: boolean;
  /** Whether ALL peers are older than the threshold. */
  allPeersStale: boolean;
  /** Number of peers whose heartbeat is stale. */
  stalePeerCount: number;
  /** Age (ms) of the most recent peer heartbeat, or null if no peers. */
  freshestPeerAgeMs: number | null;
}

const HEARTBEAT_EXTENSION = '.heartbeat';

function heartbeatDir(syncFolder: string): string {
  return path.join(syncFolder, 'sync');
}

function heartbeatPath(syncFolder: string, deviceId: string): string {
  return path.join(heartbeatDir(syncFolder), `${deviceId}${HEARTBEAT_EXTENSION}`);
}

/**
 * Write this device's heartbeat file to the shared folder.
 * Overwrites any existing heartbeat for this device.
 */
export function writeHeartbeat(syncFolder: string, deviceId: string): void {
  const filePath = heartbeatPath(syncFolder, deviceId);
  const payload: HeartbeatPayload = {
    deviceId,
    timestamp: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(filePath, JSON.stringify(payload), 'utf-8');
  } catch (e) {
    syncLog('warn', 'Failed to write heartbeat', { error: errorMessage(e) });
  }
}

/**
 * Read all peer heartbeat files (excluding our own device).
 */
export function readPeerHeartbeats(syncFolder: string, ownDeviceId: string): PeerHeartbeat[] {
  const dir = heartbeatDir(syncFolder);
  const now = Date.now();
  const peers: PeerHeartbeat[] = [];

  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return peers;
  }

  for (const entry of entries) {
    if (!entry.endsWith(HEARTBEAT_EXTENSION)) continue;

    const peerDeviceId = entry.slice(0, -HEARTBEAT_EXTENSION.length);
    if (peerDeviceId === ownDeviceId) continue;

    const filePath = path.join(dir, entry);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const payload = JSON.parse(raw) as HeartbeatPayload;
      const ts = new Date(payload.timestamp).getTime();
      if (isNaN(ts)) continue;

      peers.push({
        deviceId: payload.deviceId || peerDeviceId,
        timestamp: payload.timestamp,
        ageMs: now - ts,
      });
    } catch {
      // Corrupt or locked heartbeat file — skip
    }
  }

  return peers;
}

/**
 * Check whether all peers' heartbeats are stale (older than thresholdMs).
 */
export function checkStaleness(
  syncFolder: string,
  ownDeviceId: string,
  thresholdMs: number,
): StalenessResult {
  const peers = readPeerHeartbeats(syncFolder, ownDeviceId);

  if (peers.length === 0) {
    return { hasPeers: false, allPeersStale: false, stalePeerCount: 0, freshestPeerAgeMs: null };
  }

  let stalePeerCount = 0;
  let freshestAgeMs = Infinity;

  for (const peer of peers) {
    if (peer.ageMs > thresholdMs) {
      stalePeerCount++;
    }
    if (peer.ageMs < freshestAgeMs) {
      freshestAgeMs = peer.ageMs;
    }
  }

  return {
    hasPeers: true,
    allPeersStale: stalePeerCount === peers.length,
    stalePeerCount,
    freshestPeerAgeMs: freshestAgeMs === Infinity ? null : freshestAgeMs,
  };
}
