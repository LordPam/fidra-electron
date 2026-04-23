import { create } from 'zustand';

/**
 * Lightweight signal store for attachment data invalidation.
 *
 * When sync (Local Sync or Cloud Connect) imports attachment changes,
 * it bumps `revision`. Components displaying attachments subscribe to
 * this value and refetch when it changes.
 */
interface AttachmentSignalState {
  revision: number;
  bump: () => void;
}

export const useAttachmentSignal = create<AttachmentSignalState>((set) => ({
  revision: 0,
  bump: () => set((s) => ({ revision: s.revision + 1 })),
}));
