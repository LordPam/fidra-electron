export interface RecoveryFile {
  source: string;
  relativePath: string;
  sha256: string;
  size: number;
  kind: 'bundle' | 'snapshot' | 'attachment' | 'metadata';
}
export interface RecoveryPeer {
  deviceId: string;
  name: string;
  hasLedger: boolean;
  retired: boolean;
}
export interface RecoveryConflict {
  id: string;
  table: string;
  entity: string;
  field: string;
  local: string | null;
  remote: string | null;
  jointTransfer: boolean;
  transfer?: { local: { id: string; sheet: string; amount: string; type: string; date: string }[]; remote: { id: string; sheet: string; amount: string; type: string; date: string }[]; remoteError?: string };
}
export interface RecoveryAttachment {
  id: string;
  name: string;
  alternatives: { hash: string; size: number; source: string }[];
  selectedHash: string | null;
}
export interface RecoveryAccountSummary {
  sheet: string;
  beforePence: number;
  afterPence: number;
  created: number;
  changed: number;
  deleted: number;
}
export interface RecoveryPreview {
  id: string;
  phase: 'preparing' | 'review' | 'publishing' | 'published';
  createdAt: string;
  sourceName: string;
  files: number;
  duplicates: number;
  issues: string[];
  warnings: string[];
  peers: RecoveryPeer[];
  conflicts: RecoveryConflict[];
  attachments: RecoveryAttachment[];
  accounts: RecoveryAccountSummary[];
  changes: { table: string; id: string; before: Record<string, string | number | null> | null; after: Record<string, string | number | null> | null }[];
  ledgerDigest: string;
  reviewDigest: string;
  authorityFingerprint: string;
  publicationFolder?: string;
  publicationReviewDigest?: string;
  publishedDbPath?: string;
  publishedFolder?: string;
}
export interface RecoveryPrepareInput { mailboxes: string[]; peerLedgers: string[] }
export interface RecoveryPublishInput {
  id: string;
  destinationFolder: string;
  retiredDevices: string[];
  confirmPausedClients: boolean;
  confirmReviewedChanges: boolean;
  reviewDigest: string;
}
export type RecoveryResult<T> = { success: true; value: T } | { success: false; error: string };
