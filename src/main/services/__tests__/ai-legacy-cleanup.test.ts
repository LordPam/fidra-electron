import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { retireLegacyAiConnections } from '../ai-legacy-cleanup';

describe('retiring the manual AI trial', () => {
  it('removes recognised capability files and preserves unknown files and link destinations', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-legacy-ai-'));
    try {
      const directory = path.join(root, 'connections'); fs.mkdirSync(directory);
      const legacy = path.join(directory, `chatgpt-${'a'.repeat(24)}.json`);
      fs.writeFileSync(legacy, JSON.stringify({ url: 'http://127.0.0.1:1234/bridge', token: 'b'.repeat(64), expiresAt: '2026-10-24T00:00:00Z' }));
      fs.writeFileSync(path.join(directory, 'statement.json'), 'financial data');
      const target = path.join(root, 'private.json'); fs.writeFileSync(target, 'do not delete');
      fs.symlinkSync(target, path.join(directory, `claude-${'c'.repeat(24)}.json`));
      retireLegacyAiConnections(directory);
      expect(fs.existsSync(legacy)).toBe(false);
      expect(fs.readFileSync(path.join(directory, 'statement.json'), 'utf8')).toBe('financial data');
      expect(fs.readFileSync(target, 'utf8')).toBe('do not delete');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
