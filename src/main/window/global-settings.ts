import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { safeStorage } from 'electron';
import type { GlobalSettings, RecentFileEntry } from '../../shared/global-settings-types';
import type { CloudServerConfig } from '../../shared/ipc-types';

// ─── Credential encryption ──────────────────────────────────────────
// Sensitive fields in CloudServerConfig are encrypted at rest using the
// OS keychain via electron.safeStorage. Encrypted values are stored as
// "enc:<base64>" so we can distinguish them from legacy plaintext.

const ENC_PREFIX = 'enc:';

function encryptValue(plaintext: string): string {
  if (!plaintext || !safeStorage.isEncryptionAvailable()) return plaintext;
  const buf = safeStorage.encryptString(plaintext);
  return ENC_PREFIX + buf.toString('base64');
}

function decryptValue(stored: string): string {
  if (!stored || !stored.startsWith(ENC_PREFIX)) return stored;
  if (!safeStorage.isEncryptionAvailable()) return stored; // Can't decrypt — return as-is
  const buf = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64');
  return safeStorage.decryptString(buf);
}

/** Fields in CloudServerConfig that contain secrets. */
const SENSITIVE_KEYS: (keyof CloudServerConfig)[] = [
  'connectionString',
  'storageKey',
  'anonKey',
];

function encryptConfig(config: CloudServerConfig): CloudServerConfig {
  const copy = { ...config };
  for (const key of SENSITIVE_KEYS) {
    const val = copy[key];
    if (typeof val === 'string' && val && !val.startsWith(ENC_PREFIX)) {
      (copy as Record<string, unknown>)[key] = encryptValue(val);
    }
  }
  return copy;
}

function decryptConfig(config: CloudServerConfig): CloudServerConfig {
  const copy = { ...config };
  for (const key of SENSITIVE_KEYS) {
    const val = copy[key];
    if (typeof val === 'string' && val.startsWith(ENC_PREFIX)) {
      (copy as Record<string, unknown>)[key] = decryptValue(val);
    }
  }
  return copy;
}

const MAX_RECENT_FILES = 10;

function getSettingsDir(): string {
  return path.join(os.homedir(), '.fidra');
}

export function getCloudCacheDir(): string {
  return path.join(getSettingsDir(), 'cloud-cache');
}

export function getCloudCachePath(serverId: string): string {
  return path.join(getCloudCacheDir(), `${serverId}.fdra`);
}

function getSettingsPath(): string {
  return path.join(getSettingsDir(), 'settings.json');
}

function defaultSettings(): GlobalSettings {
  return {
    recentFiles: [],
    lastFile: null,
    lastOpenedAt: null,
    alwaysShowFileChooser: false,
    firstRunComplete: false,
    cloudServers: [],
    activeServerId: null,
    uiPreferences: { tableZoom: 0.8, plannedTableZoom: 0.8, activitiesTableZoom: 0.8, showPlanned: false, filteredBalanceMode: false, theme: 'system', reportOrgName: '' },
  };
}

export function loadGlobalSettings(): GlobalSettings {
  const settingsPath = getSettingsPath();
  try {
    if (!fs.existsSync(settingsPath)) {
      return defaultSettings();
    }
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = JSON.parse(raw) as any;

    // Migrate old `zoom` key → `uiPreferences`
    if (parsed.zoom && !parsed.uiPreferences) {
      parsed.uiPreferences = {
        ...defaultSettings().uiPreferences,
        ...parsed.zoom,
      };
      delete parsed.zoom;
    }

    const merged: GlobalSettings = {
      ...defaultSettings(),
      ...parsed,
    };
    // Decrypt sensitive fields in cloud server configs
    merged.cloudServers = merged.cloudServers.map(decryptConfig);

    // Auto-encrypt plaintext configs from older versions
    if (safeStorage.isEncryptionAvailable() && merged.cloudServers.some(
      (c) => SENSITIVE_KEYS.some((k) => {
        const v = c[k];
        return typeof v === 'string' && v && !v.startsWith(ENC_PREFIX);
      }),
    )) {
      // Re-read raw to encrypt in place, then save back
      const rawAgain = JSON.parse(raw) as GlobalSettings;
      rawAgain.cloudServers = (rawAgain.cloudServers ?? []).map(encryptConfig);
      const dir = getSettingsDir();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmpPath = getSettingsPath() + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(rawAgain, null, 2), 'utf-8');
      fs.renameSync(tmpPath, getSettingsPath());
    }

    return merged;
  } catch {
    return defaultSettings();
  }
}

export function saveGlobalSettings(settings: GlobalSettings): void {
  const dir = getSettingsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // Encrypt sensitive fields before writing to disk
  const toWrite = {
    ...settings,
    cloudServers: settings.cloudServers.map(encryptConfig),
  };
  const settingsPath = getSettingsPath();
  const tmpPath = settingsPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(toWrite, null, 2), 'utf-8');
  fs.renameSync(tmpPath, settingsPath);
}

export function addRecentFile(filePath: string): void {
  const settings = loadGlobalSettings();
  const normalized = path.resolve(filePath);
  const name = path.basename(normalized);
  const now = new Date().toISOString();

  // Remove existing entry for this path
  settings.recentFiles = settings.recentFiles.filter(
    (f) => path.resolve(f.path) !== normalized,
  );

  // Add to front
  const entry: RecentFileEntry = { path: normalized, name, lastOpenedAt: now };
  settings.recentFiles.unshift(entry);

  // Enforce max
  if (settings.recentFiles.length > MAX_RECENT_FILES) {
    settings.recentFiles = settings.recentFiles.slice(0, MAX_RECENT_FILES);
  }

  settings.lastFile = normalized;
  settings.lastOpenedAt = now;

  saveGlobalSettings(settings);
}

export function removeRecentFile(filePath: string): void {
  const settings = loadGlobalSettings();
  const normalized = path.resolve(filePath);
  settings.recentFiles = settings.recentFiles.filter(
    (f) => path.resolve(f.path) !== normalized,
  );
  if (settings.lastFile && path.resolve(settings.lastFile) === normalized) {
    settings.lastFile = settings.recentFiles[0]?.path ?? null;
    settings.lastOpenedAt = settings.recentFiles[0]?.lastOpenedAt ?? null;
  }
  saveGlobalSettings(settings);
}

// ─── Cloud server CRUD ──────────────────────────────────────────────

export function getCloudServer(serverId: string): CloudServerConfig | null {
  const settings = loadGlobalSettings();
  return settings.cloudServers.find((s) => s.id === serverId) ?? null;
}

export function addCloudServer(config: CloudServerConfig): void {
  const settings = loadGlobalSettings();
  settings.cloudServers.push(config);
  saveGlobalSettings(settings);
}

export function updateCloudServer(config: CloudServerConfig): void {
  const settings = loadGlobalSettings();
  const idx = settings.cloudServers.findIndex((s) => s.id === config.id);
  if (idx >= 0) {
    settings.cloudServers[idx] = config;
  } else {
    settings.cloudServers.push(config);
  }
  saveGlobalSettings(settings);
}

export function removeCloudServer(serverId: string): void {
  const settings = loadGlobalSettings();
  settings.cloudServers = settings.cloudServers.filter((s) => s.id !== serverId);
  if (settings.activeServerId === serverId) {
    settings.activeServerId = null;
  }
  saveGlobalSettings(settings);
}

export function markFirstRunComplete(): void {
  const settings = loadGlobalSettings();
  settings.firstRunComplete = true;
  saveGlobalSettings(settings);
}

// ─── UI preferences ─────────────────────────────────────────────────

export function getUiPreferences(): GlobalSettings['uiPreferences'] {
  return loadGlobalSettings().uiPreferences;
}

export function saveUiPreferences(prefs: GlobalSettings['uiPreferences']): void {
  const settings = loadGlobalSettings();
  settings.uiPreferences = prefs;
  saveGlobalSettings(settings);
}

export function ensureCloudCacheDir(): void {
  const dir = getCloudCacheDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
