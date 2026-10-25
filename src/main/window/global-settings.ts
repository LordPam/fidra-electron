import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { GlobalSettings, RecentFileEntry } from '../../shared/global-settings-types';

const MAX_RECENT_FILES = 10;

function getSettingsDir(): string {
  return path.join(os.homedir(), '.fidra');
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
    uiPreferences: { tableZoom: 0.8, plannedTableZoom: 0.8, activitiesTableZoom: 0.8, showPlanned: false, filteredBalanceMode: false, theme: 'system', sidebarCollapsed: false },
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

    const defaults = defaultSettings();
    const merged: GlobalSettings = {
      ...defaults,
      ...parsed,
      // uiPreferences gains keys over time; a settings file written by an older
      // build would otherwise shadow the whole object and drop the new ones.
      uiPreferences: { ...defaults.uiPreferences, ...parsed.uiPreferences },
    };
    // If the sentinel file exists, always honour it (survives JSON corruption cycles)
    if (!merged.firstRunComplete && isFirstRunSentinelPresent()) {
      merged.firstRunComplete = true;
    }
    return merged;
  } catch (e) {
    console.error('[global-settings] Failed to load settings:', e instanceof Error ? e.message : String(e));
    // If the JSON is unreadable but the sentinel file exists, preserve firstRunComplete
    const defaults = defaultSettings();
    if (isFirstRunSentinelPresent()) {
      defaults.firstRunComplete = true;
    }
    return defaults;
  }
}

export function saveGlobalSettings(settings: GlobalSettings, requireSuccess = false): void {
  const dir = getSettingsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const toWrite = settings;
  const settingsPath = getSettingsPath();
  const tmpPath = settingsPath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(toWrite, null, 2), 'utf-8');
    fs.renameSync(tmpPath, settingsPath);
  } catch (e) {
    console.error('[global-settings] Failed to save settings:', e instanceof Error ? e.message : String(e));
    // Fallback: try writing directly (skip atomic rename — better than losing data)
    try {
      fs.writeFileSync(settingsPath, JSON.stringify(toWrite, null, 2), 'utf-8');
    } catch (e2) {
      console.error('[global-settings] Direct write also failed:', e2 instanceof Error ? e2.message : String(e2));
      if (requireSuccess) throw e2;
    }
  }
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

/** Sentinel file that survives settings.json corruption. */
function getFirstRunSentinelPath(): string {
  return path.join(getSettingsDir(), '.first-run-complete');
}

function isFirstRunSentinelPresent(): boolean {
  try { return fs.existsSync(getFirstRunSentinelPath()); } catch { return false; }
}

export function markFirstRunComplete(): void {
  const settings = loadGlobalSettings();
  settings.firstRunComplete = true;
  saveGlobalSettings(settings);
  // Write a sentinel file as a fallback — immune to JSON corruption
  try {
    const dir = getSettingsDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getFirstRunSentinelPath(), new Date().toISOString(), 'utf-8');
  } catch (e) {
    console.error('[global-settings] Failed to write first-run sentinel:', e instanceof Error ? e.message : String(e));
  }
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
