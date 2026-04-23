import fs from 'node:fs';
import path from 'node:path';
import { type FSWatcher, watch as chokidarWatch } from 'chokidar';
import { isBundleFile } from './bundle-io';
import { syncLog, errorMessage } from './sync-log';

export interface FolderWatcherOptions {
  syncFolder: string;
  pollIntervalMs?: number; // default 30_000
  onBundleDetected: (filePath: string) => void;
  onError?: (error: string) => void;
}

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEBOUNCE_MS = 300;

export class FolderWatcher {
  private readonly syncDir: string;
  private readonly pollIntervalMs: number;
  private readonly onBundleDetected: (filePath: string) => void;
  private readonly onError: ((error: string) => void) | null;

  private watcher: FSWatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private knownFiles = new Set<string>();
  private paused = false;
  private running = false;

  // Debounce: accumulate file paths during the debounce window
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingFiles = new Set<string>();

  constructor(options: FolderWatcherOptions) {
    this.syncDir = path.join(options.syncFolder, 'sync');
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.onBundleDetected = options.onBundleDetected;
    this.onError = options.onError ?? null;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    // Snapshot existing files so we don't re-report them
    this.knownFiles = this.listBundleFiles();

    // chokidar watcher
    this.watcher = chokidarWatch(this.syncDir, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
      ignored: /\.tmp$/,
      depth: 0,
    });

    this.watcher.on('add', (filePath: string) => {
      const basename = path.basename(filePath);
      if (!isBundleFile(basename)) return;
      this.scheduleEmit(filePath);
    });

    this.watcher.on('error', (err: unknown) => {
      const msg = errorMessage(err);
      syncLog('error', 'chokidar watcher error', { syncDir: this.syncDir, error: msg });
      this.onError?.(msg);
    });

    // Polling fallback
    this.pollTimer = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.watcher) {
      void this.watcher.close();
      this.watcher = null;
    }

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.pendingFiles.clear();
    this.knownFiles.clear();
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  // ─── Internal ────────────────────────────────────────────────────

  private scheduleEmit(filePath: string): void {
    this.pendingFiles.add(filePath);

    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    this.debounceTimer = setTimeout(() => {
      this.flushPending();
    }, DEBOUNCE_MS);
  }

  private flushPending(): void {
    const files = [...this.pendingFiles];
    this.pendingFiles.clear();
    this.debounceTimer = null;

    for (const filePath of files) {
      const basename = path.basename(filePath);
      if (this.knownFiles.has(basename)) continue;
      this.knownFiles.add(basename);
      if (!this.paused) {
        this.onBundleDetected(filePath);
      }
    }
  }

  private poll(): void {
    const currentFiles = this.listBundleFiles();

    for (const filename of currentFiles) {
      if (this.knownFiles.has(filename)) continue;
      this.knownFiles.add(filename);
      if (!this.paused) {
        this.onBundleDetected(path.join(this.syncDir, filename));
      }
    }
  }

  private listBundleFiles(): Set<string> {
    try {
      const entries = fs.readdirSync(this.syncDir);
      return new Set(entries.filter(isBundleFile));
    } catch {
      return new Set();
    }
  }
}
