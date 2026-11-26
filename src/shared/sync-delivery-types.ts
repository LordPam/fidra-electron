/** Historical exact-bundle receipts, not a claim of current ledger convergence. */
export interface PeerDeliveryEvidence {
  deviceId: string;
  personName: string;
  acknowledgedBundles: number;
  pendingBundles: number;
  reviewRequiredBundles: number;
  lastReceiptObservedAt: string | null;
}

export interface LocalSyncDelivery {
  folderBound: boolean;
  outboundBundles: number;
  peers: PeerDeliveryEvidence[];
}
