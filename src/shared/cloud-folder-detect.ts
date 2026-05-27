/** Cloud-synced folder path fragments (macOS iCloud, OneDrive, Dropbox, Google Drive). */
export const CLOUD_FOLDER_MARKERS = [
  'Library/Mobile Documents/com~apple~CloudDocs',
  '/OneDrive',
  '/Dropbox',
  '/Google Drive',
  '/My Drive',
];

export function isCloudSyncedPath(p: string): boolean {
  return CLOUD_FOLDER_MARKERS.some((m) => p.includes(m));
}
