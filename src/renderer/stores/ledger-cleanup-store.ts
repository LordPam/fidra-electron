import { create } from 'zustand';
import { useTransactionStore } from './transaction-store';
import { usePlannedStore } from './planned-store';
import { useSheetStore } from './sheet-store';
import { useInvoiceStore } from './invoice-store';
import { useCategoryStore } from './category-store';

interface LedgerCleanupState {
  refresh: () => Promise<void>;
  changeHistory: (id: string, direction: 'undo' | 'redo') => Promise<void>;
}
export const useLedgerCleanupStore = create<LedgerCleanupState>((_set, get) => ({
  refresh: async () => {
    await Promise.all([useTransactionStore.getState().silentRefresh(), usePlannedStore.getState().silentRefresh(), useSheetStore.getState().silentRefresh(), useInvoiceStore.getState().loadAll(), useCategoryStore.getState().silentRefresh()]);
  },
  changeHistory: async (id, direction) => {
    await window.api.changeLedgerCleanup({ id, direction });
    await get().refresh();
  },
}));
