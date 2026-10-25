import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AuthSession } from '../../../shared/auth-types';
const mock = vi.hoisted(() => ({ home: '', secure: false }));
vi.mock('electron', () => ({ app: { getPath: () => mock.home }, safeStorage: {
  isEncryptionAvailable: () => mock.secure,
  encryptString: (value: string) => Buffer.from(`protected:${value}`),
  decryptString: (value: Buffer) => value.toString().replace(/^protected:/, ''),
} }));
import { SessionStore } from '../session-store';
const session: AuthSession = { user: { id: 'sam', email: 'sam@example.test', personnelId: 'sam' }, accessToken: 'test-only-group-key', refreshToken: '', expiresAt: 0 };
beforeEach(() => { mock.home = fs.mkdtempSync(path.join(os.tmpdir(), 'fidra-session-test-')); mock.secure = false; SessionStore.clearMemory(); });
afterEach(() => { SessionStore.clearMemory(); fs.rmSync(mock.home, { recursive: true, force: true }); });
describe('session storage', () => {
  it('hands off sign-in within this process without a plaintext fallback', () => {
    new SessionStore().saveSession('local-test', session);
    expect(new SessionStore().loadSession('local-test')).toEqual(session);
    expect(fs.readdirSync(path.join(mock.home, '.fidra', 'sessions'))).toEqual([]);
    SessionStore.clearMemory(); expect(new SessionStore().loadSession('local-test')).toBeNull();
  });
  it('persists only through secure storage and deletes both disk and memory on sign-out', () => {
    mock.secure = true;
    new SessionStore().saveSession('local-test', session); SessionStore.clearMemory();
    expect(new SessionStore().loadSession('local-test')).toEqual(session);
    new SessionStore().deleteSession('local-test');
    expect(new SessionStore().loadSession('local-test')).toBeNull();
    expect(fs.readdirSync(path.join(mock.home, '.fidra', 'sessions'))).toEqual([]);
  });
  it('retires a previous plaintext session instead of restoring its credentials', () => {
    const directory = path.join(mock.home, '.fidra', 'sessions'); fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'local-test.enc.json'); fs.writeFileSync(file, JSON.stringify(session));
    expect(new SessionStore().loadSession('local-test')).toBeNull(); expect(fs.existsSync(file)).toBe(false);
  });
});
