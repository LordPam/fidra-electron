import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import type { AuthSession } from '../../shared/auth-types';

function getSessionDir(): string {
  const dir = path.join(app.getPath('home'), '.fidra', 'sessions');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getSessionPath(serverId: string): string {
  // Sanitize serverId for filename safety
  const safe = serverId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(getSessionDir(), `${safe}.enc`);
}

export class SessionStore {
  private static readonly memory = new Map<string, AuthSession>();
  static clearMemory(): void { SessionStore.memory.clear(); }
  saveSession(serverId: string, session: AuthSession): void {
    this.deleteSession(serverId);
    SessionStore.memory.set(serverId, structuredClone(session));
    const json = JSON.stringify(session);
    const legacyPath = getSessionPath(serverId) + '.json';
    if (fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath);
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(json);
      fs.writeFileSync(getSessionPath(serverId), encrypted, { mode: 0o600 });
    } else {
      // Remain signed in for this process, but never persist a plaintext key.
      return;
    }
  }

  loadSession(serverId: string): AuthSession | null {
    const cached = SessionStore.memory.get(serverId);
    if (cached) return structuredClone(cached);
    try {
      const encPath = getSessionPath(serverId);
      const plainPath = encPath + '.json';

      if (safeStorage.isEncryptionAvailable() && fs.existsSync(encPath)) {
        const encrypted = fs.readFileSync(encPath);
        const json = safeStorage.decryptString(encrypted);
        const session = JSON.parse(json) as AuthSession;
        SessionStore.memory.set(serverId, structuredClone(session));
        return session;
      } else if (fs.existsSync(plainPath)) {
        // Retire the former plaintext fallback without reading its credentials.
        fs.unlinkSync(plainPath);
      }
    } catch (e) {
      console.warn(`[SESSION-STORE] Failed to load session for ${serverId}:`, e);
    }
    return null;
  }

  deleteSession(serverId: string): void {
    SessionStore.memory.delete(serverId);
    const encPath = getSessionPath(serverId);
    const plainPath = encPath + '.json';
    try { fs.unlinkSync(encPath); } catch { /* ignore */ }
    try { fs.unlinkSync(plainPath); } catch { /* ignore */ }
  }
}

/** Derive a stable session ID from a database file path (for Local Sync sessions). */
export function dbPathToSessionId(dbPath: string): string {
  return 'local-' + crypto.createHash('sha256').update(dbPath).digest('hex').slice(0, 16);
}
