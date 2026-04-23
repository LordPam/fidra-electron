import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureSyncFolderStructure } from '../bundle-io';
import { FolderWatcher } from '../folder-watcher';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('FolderWatcher', () => {
  let tmpDir: string;
  let syncDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-test-'));
    ensureSyncFolderStructure(tmpDir);
    syncDir = path.join(tmpDir, 'sync');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('detects new .bundle file', async () => {
    const detected: string[] = [];
    const watcher = new FolderWatcher({
      syncFolder: tmpDir,
      pollIntervalMs: 300, // fast polling so test doesn't rely solely on chokidar
      onBundleDetected: (fp) => detected.push(fp),
    });

    try {
      watcher.start();
      expect(watcher.isRunning()).toBe(true);

      // Give chokidar a moment to initialize
      await sleep(500);

      // Write a bundle file (write as .tmp then rename to simulate atomic write)
      const bundlePath = path.join(syncDir, 'dev-1_0000000001.bundle');
      const tmpPath = bundlePath + '.tmp';
      fs.writeFileSync(tmpPath, 'data');
      fs.renameSync(tmpPath, bundlePath);

      // Wait for chokidar detection + awaitWriteFinish + debounce
      await vi.waitFor(() => expect(detected.length).toBeGreaterThanOrEqual(1), {
        timeout: 5000,
      });

      expect(detected[0]).toBe(bundlePath);
    } finally {
      watcher.stop();
    }
  });

  test('ignores .tmp files', async () => {
    const detected: string[] = [];
    const watcher = new FolderWatcher({
      syncFolder: tmpDir,
      onBundleDetected: (fp) => detected.push(fp),
    });

    try {
      watcher.start();

      // Write a .tmp file (should be ignored by chokidar's `ignored` pattern)
      fs.writeFileSync(
        path.join(syncDir, 'dev-1_0000000001.bundle.tmp'),
        'partial',
      );

      // Wait a bit and verify no detection
      await sleep(1500);
      expect(detected).toHaveLength(0);
    } finally {
      watcher.stop();
    }
  });

  test('polling fallback detects files', async () => {
    const detected: string[] = [];
    const watcher = new FolderWatcher({
      syncFolder: tmpDir,
      pollIntervalMs: 200, // fast polling for test
      onBundleDetected: (fp) => detected.push(fp),
    });

    try {
      watcher.start();

      // Pre-write a file (chokidar may also catch it, but polling should too)
      const bundlePath = path.join(syncDir, 'dev-1_0000000001.bundle');
      fs.writeFileSync(bundlePath, 'data');

      await vi.waitFor(() => expect(detected.length).toBeGreaterThanOrEqual(1), {
        timeout: 5000,
      });

      expect(path.basename(detected[0])).toBe('dev-1_0000000001.bundle');
    } finally {
      watcher.stop();
    }
  });

  test('pause suppresses events, resume re-enables', async () => {
    const detected: string[] = [];
    const watcher = new FolderWatcher({
      syncFolder: tmpDir,
      pollIntervalMs: 200,
      onBundleDetected: (fp) => detected.push(fp),
    });

    try {
      watcher.start();
      watcher.pause();

      // Write while paused
      fs.writeFileSync(
        path.join(syncDir, 'dev-1_0000000001.bundle'),
        'data',
      );

      // Wait for poll + debounce — should NOT fire callback
      await sleep(1000);
      expect(detected).toHaveLength(0);

      watcher.resume();

      // Write another file after resume
      fs.writeFileSync(
        path.join(syncDir, 'dev-1_0000000002.bundle'),
        'data',
      );

      await vi.waitFor(() => expect(detected.length).toBeGreaterThanOrEqual(1), {
        timeout: 5000,
      });

      // Only the post-resume bundle should be detected
      expect(detected.every((fp) => fp.includes('0000000002'))).toBe(true);
    } finally {
      watcher.stop();
    }
  });

  test('stop cleans up', () => {
    const watcher = new FolderWatcher({
      syncFolder: tmpDir,
      onBundleDetected: () => {},
    });

    watcher.start();
    expect(watcher.isRunning()).toBe(true);

    watcher.stop();
    expect(watcher.isRunning()).toBe(false);
  });

  test('start is idempotent', () => {
    const watcher = new FolderWatcher({
      syncFolder: tmpDir,
      onBundleDetected: () => {},
    });

    try {
      watcher.start();
      watcher.start(); // should not throw or create duplicate watchers
      expect(watcher.isRunning()).toBe(true);
    } finally {
      watcher.stop();
    }
  });
});
