import type { LocalSyncDelivery } from '../../shared/sync-delivery-types';
import { formatRelativeTime } from '@/lib/format';

export function SyncDeliveryDetails({ delivery }: { delivery: LocalSyncDelivery | null }) {
  return (
    <div className="space-y-2 text-xs">
      <p className="font-medium text-foreground">Delivery evidence</p>
      <p className="text-muted-foreground">
        {delivery?.folderBound ? 'Folder identity is pinned on this device.' : 'Folder identity has not been verified. Sync may be paused.'}
        {' '}Folder writes alone do not confirm cloud upload or delivery.
      </p>
      {delivery && delivery.peers.length > 0 ? (
        <div className="space-y-3">
          {delivery.peers.map((peer) => (
            <div key={peer.deviceId} className="rounded-md border border-border p-2 space-y-1">
              <p className="font-medium">{peer.personName} <span className="font-normal text-muted-foreground">({peer.deviceId.slice(0, 8)})</span></p>
              <p>{peer.acknowledgedBundles} of {delivery.outboundBundles} tracked bundles reported received; {peer.pendingBundles} awaiting receipt.</p>
              <p className="text-muted-foreground">
                Last receipt observed: {peer.lastReceiptObservedAt ? formatRelativeTime(peer.lastReceiptObservedAt) : 'none'}
              </p>
              {peer.reviewRequiredBundles > 0 && (
                <p className="text-amber-600 dark:text-amber-400">
                  {peer.reviewRequiredBundles} received with changes queued for review. Check that device for the current review status.
                </p>
              )}
            </div>
          ))}
          <p className="text-muted-foreground">These receipts cover past ledger imports. They do not confirm attachment receipt, current state on an offline device, or resolution of all financial conflicts.</p>
        </div>
      ) : (
        <p className="text-muted-foreground">No other device has been identified yet. Peer delivery is unverified.</p>
      )}
    </div>
  );
}
