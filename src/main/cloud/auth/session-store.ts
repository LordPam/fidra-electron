import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import type { AuthSession } from '../../../shared/auth-types';

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
  saveSession(serverId: string, session: AuthSession): void {
    const json = JSON.stringify(session);
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(json);
      fs.writeFileSync(getSessionPath(serverId), encrypted);
    } else {
      // Fallback: store as plain text (dev mode or unsupported platform)
      fs.writeFileSync(getSessionPath(serverId) + '.json', json, 'utf-8');
    }
  }

  loadSession(serverId: string): AuthSession | null {
    try {
      const encPath = getSessionPath(serverId);
      const plainPath = encPath + '.json';

      if (safeStorage.isEncryptionAvailable() && fs.existsSync(encPath)) {
        const encrypted = fs.readFileSync(encPath);
        const json = safeStorage.decryptString(encrypted);
        return JSON.parse(json) as AuthSession;
      } else if (fs.existsSync(plainPath)) {
        const json = fs.readFileSync(plainPath, 'utf-8');
        return JSON.parse(json) as AuthSession;
      }
    } catch (e) {
      console.warn(`[SESSION-STORE] Failed to load session for ${serverId}:`, e);
    }
    return null;
  }

  deleteSession(serverId: string): void {
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
