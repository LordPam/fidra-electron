export interface UpdateManifest {
  schemaVersion: 1;
  channel: 'stable';
  version: string;
  publishedAt: string;
  platform: 'darwin' | 'win32';
  arch: 'arm64' | 'x64';
  releaseNotes: string[];
  artifact: { url: string; fileName: string; sha256: string; size: number };
  signature: string;
}

export interface UpdateStatus {
  revision: number;
  phase: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'preparing' | 'up-to-date' | 'error' | 'unavailable';
  currentVersion: string;
  version: string | null;
  releaseNotes: string[];
  progress: number;
  lastCheckedAt: string | null;
  automatic: boolean;
  remindAfter: string | null;
  installerReady: boolean;
  error: string | null;
  message: string | null;
}

export interface UpdatePreparationReply {
  requestId: string;
  reason: string | null;
}
