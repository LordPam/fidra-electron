import { create } from 'zustand';
import type { UpdateStatus } from '../../shared/update-types';
import { updateBlocker, flushUpdateWork, setPreparingUpdate } from '@/services/update-preparation';

interface UpdateState {
  status: UpdateStatus | null;
  actionError: string | null;
  preparing: boolean;
  accept: (status: UpdateStatus) => void;
  connect: () => () => void;
  check: () => Promise<void>;
  download: () => Promise<void>;
  openInstaller: () => Promise<void>;
  remindLater: () => Promise<void>;
  setAutomatic: (automatic: boolean) => Promise<void>;
  openReleasePage: () => Promise<void>;
}

export const useUpdateStore = create<UpdateState>((set, get) => {
  const run = async (action: () => Promise<UpdateStatus | void>) => {
    set({ actionError: null });
    try {
      const status = await action();
      if (status) get().accept(status);
    } catch (error) {
      set({ actionError: error instanceof Error ? error.message : 'The update action failed. Please retry.' });
    }
  };
  return {
    status: null, actionError: null, preparing: false,
    accept: (status) => set((state) => !state.status || status.revision >= state.status.revision ? { status } : {}),
    connect: () => {
      // Subscribe before querying so a new window cannot miss a transition.
      const unsubscribe = window.api.onUpdateStatus((status) => get().accept(status));
      void run(window.api.getUpdateStatus);
      const release = () => { document.body.inert = false; setPreparingUpdate(false); set({ preparing: false }); };
      const cancel = window.api.onCancelUpdatePreparation(release);
      const show = window.api.onShowUpdateSettings(() => { window.location.hash = '#/settings'; });
      const handlePreparation = async (requestId: string, reply: typeof window.api.replyUpdatePreparation) => {
        let reason = updateBlocker(false);
        try {
          if (!reason) {
            setPreparingUpdate(true);
            // Commit blur-based edits, stop repeat autosaves, and drain existing jobs.
            (document.activeElement as HTMLElement | null)?.blur();
            document.body.inert = true;
            set({ preparing: true });
            reason = await window.api.waitForPendingWork(false);
            if (!reason) await flushUpdateWork();
            if (!reason) reason = await window.api.waitForPendingWork();
            reason ??= updateBlocker();
          }
        } catch (error) {
          reason = error instanceof Error ? error.message : 'Changes could not be saved. Review them before updating.';
        }
        await reply({ requestId, reason }).catch(() => release());
      };
      const prepare = window.api.onPrepareUpdate((id) => void handlePreparation(id, window.api.replyUpdatePreparation));
      const devicePrepare = window.api.onPrepareDevice((id) => void handlePreparation(id, window.api.replyDevicePreparation));
      const deviceCancel = window.api.onCancelDevicePreparation(release);
      return () => { unsubscribe(); cancel(); prepare(); devicePrepare(); deviceCancel(); show(); release(); };
    },
    check: () => run(window.api.checkUpdates),
    download: () => run(window.api.downloadUpdate),
    openInstaller: () => run(window.api.openUpdateInstaller),
    remindLater: () => run(window.api.remindUpdateLater),
    setAutomatic: (automatic) => run(() => window.api.setAutomaticUpdates(automatic)),
    openReleasePage: () => run(window.api.openUpdateReleasePage),
  };
});
