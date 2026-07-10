/**
 * Heartbeat probe for detecting stalled OneDrive sync.
 *
 * Each device periodically writes a small heartbeat file to the shared folder.
 * Peer heartbeat staleness indicates OneDrive has stopped propagating files.
 *
 * Also provides process-level detection: if the cloud sync provider (OneDrive,
 * Dropbox, etc.) isn't running at all, we can flag staleness immediately
 * without waiting for heartbeat thresholds.
 */
import { execSync } from 'node:child_process';
import dns from 'node:dns';
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

// ─── Cloud sync process detection ───────────────────────────────────

/**
 * Process names to look for per cloud provider.
 * OneDrive on macOS runs as "OneDrive" (standalone) or "OneDrive (Personal)".
 * Dropbox runs as "Dropbox". Google Drive runs as "Google Drive" or
 * "Google Drive Helper".
 */
const PROVIDER_PROCESS_MAP: Array<{ marker: string; processName: string }> = [
  { marker: '/OneDrive', processName: 'OneDrive' },
  { marker: '/Dropbox', processName: 'Dropbox' },
  { marker: '/Google Drive', processName: 'Google Drive' },
  { marker: '/My Drive', processName: 'Google Drive' },
];

/** Cache to avoid running pgrep on every heartbeat tick. */
let processCheckCache: { result: boolean; checkedAt: number; syncFolder: string } | null = null;
const PROCESS_CHECK_CACHE_MS = 60_000; // Re-check at most once per minute

/**
 * Detect the cloud sync provider from the sync folder path and check
 * whether its process is running.
 *
 * Returns `true` if the provider is running (or if the provider can't be
 * identified — assume healthy). Returns `false` only when we can
 * positively confirm the provider process is not running.
 *
 * macOS only (uses `pgrep`). Returns `true` on other platforms.
 */
export function isSyncProviderRunning(syncFolder: string): boolean {
  if (process.platform !== 'darwin') return true;

  // Use cache if fresh
  if (
    processCheckCache &&
    processCheckCache.syncFolder === syncFolder &&
    Date.now() - processCheckCache.checkedAt < PROCESS_CHECK_CACHE_MS
  ) {
    return processCheckCache.result;
  }

  // Identify the provider from the sync folder path
  const match = PROVIDER_PROCESS_MAP.find((p) => syncFolder.includes(p.marker));
  if (!match) {
    // Can't identify provider — assume running
    return true;
  }

  let running: boolean;
  try {
    // pgrep -ix: case-insensitive, exact match. Exit code 0 = found, 1 = not found.
    execSync(`pgrep -ix "${match.processName}"`, { stdio: 'ignore' });
    running = true;
  } catch {
    // pgrep exits with code 1 when no process matches
    running = false;
    syncLog('info', `Sync provider not running: ${match.processName}`);
  }

  processCheckCache = { result: running, checkedAt: Date.now(), syncFolder };
  return running;
}

// ─── Network reachability ─────────────────────────────────────────────

/** Cache to avoid DNS lookups on every heartbeat tick. */
let networkCheckCache: { reachable: boolean; checkedAt: number } | null = null;
const NETWORK_CHECK_CACHE_MS = 30_000; // Re-check at most once per 30 seconds

/**
 * Quick DNS lookup to determine if the machine has internet connectivity.
 * Uses a cached result to avoid excessive lookups. Returns a Promise
 * since dns.resolve is async.
 *
 * Returns `true` if reachable, `false` if the lookup fails (no internet).
 */
export async function isNetworkReachable(): Promise<boolean> {
  if (
    networkCheckCache &&
    Date.now() - networkCheckCache.checkedAt < NETWORK_CHECK_CACHE_MS
  ) {
    return networkCheckCache.reachable;
  }

  try {
    await dns.promises.resolve4('dns.google');
    networkCheckCache = { reachable: true, checkedAt: Date.now() };
    return true;
  } catch {
    syncLog('info', 'Network reachability check failed — no internet');
    networkCheckCache = { reachable: false, checkedAt: Date.now() };
    return false;
  }
}
