import { create } from 'zustand';
import type { TransactionRow, AttachmentRow } from '../../shared/ipc-types';

interface DeleteResult {
  success: boolean;
  deletedAttachments: AttachmentRow[];
}

interface BulkDeleteResult {
  count: number;
  deletedAttachments: Record<string, AttachmentRow[]>;
}

interface TransactionState {
  transactions: TransactionRow[];
  loading: boolean;
  error: string | null;
  /** Monotonic counter bumped on every explicit mutation (add/update/remove).
   *  silentRefresh captures this before its async fetch and bails out if it
   *  changed — prevents a stale cloud-sync fetch from overwriting a mutation
   *  that completed while the fetch was in-flight. */
  _generation: number;

  loadAll: (sheet?: string) => Promise<void>;
  silentRefresh: (sheet?: string) => Promise<void>;
  addTransaction: (data: TransactionRow) => Promise<TransactionRow>;
  updateTransaction: (data: TransactionRow) => Promise<TransactionRow>;
  removeTransaction: (id: string) => Promise<DeleteResult>;
  bulkUpdate: (data: TransactionRow[]) => Promise<TransactionRow[]>;
  bulkRemove: (ids: string[]) => Promise<BulkDeleteResult>;
  restoreTransaction: (data: TransactionRow) => Promise<TransactionRow>;
  bulkRestore: (data: TransactionRow[]) => Promise<TransactionRow[]>;
}

export const useTransactionStore = create<TransactionState>((set, get) => ({
  transactions: [],
  loading: false,
  error: null,
  _generation: 0,

  loadAll: async (sheet?: string) => {
    set({ loading: true, error: null });
    try {
      const rows = await window.api.getTransactions(sheet);
      set({ transactions: rows, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  silentRefresh: async (sheet?: string) => {
    try {
      const gen = get()._generation;
      const rows = await window.api.getTransactions(sheet);
      // If a mutation landed while we were fetching, our data is stale — bail
      // out and let the next refresh pick up the correct state.
      if (gen !== get()._generation) return;
      // Skip update if data hasn't changed to avoid unnecessary re-renders
      // that disrupt focus, scroll position, and selection state
      const current = get().transactions;
      if (current.length === rows.length && current.every((t, i) => t.id === rows[i].id && t.version === rows[i].version && t.modified_at === rows[i].modified_at)) {
        return;
      }
      set({ transactions: rows });
    } catch (e) {
      console.warn('[TransactionStore] silentRefresh failed:', e);
    }
  },

  addTransaction: async (data: TransactionRow) => {
    try {
      const result = await window.api.saveTransaction(data);
      set((state) => ({
        transactions: [result, ...state.transactions],
        _generation: state._generation + 1,
      }));
      return result;
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  updateTransaction: async (data: TransactionRow) => {
    try {
      const result = await window.api.saveTransaction(data);
      set((state) => ({
        transactions: state.transactions.map((t) => (t.id === result.id ? result : t)),
        _generation: state._generation + 1,
      }));
      return result;
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  removeTransaction: async (id: string) => {
    try {
      const result = await window.api.deleteTransaction(id) as DeleteResult;
      if (result.success) {
        set((state) => ({
          transactions: state.transactions.filter((t) => t.id !== id),
          _generation: state._generation + 1,
        }));
      }
      return result;
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  bulkUpdate: async (data: TransactionRow[]) => {
    try {
      const results = await window.api.bulkSaveTransactions(data);
      const resultMap = new Map(results.map((r) => [r.id, r]));
      set((state) => {
        const existingIds = new Set(state.transactions.map((t) => t.id));
        const updated = state.transactions.map((t) => resultMap.get(t.id) ?? t);
        const added = results.filter((r) => !existingIds.has(r.id));
        return {
          transactions: [...added, ...updated],
          _generation: state._generation + 1,
        };
      });
      return results;
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  bulkRemove: async (ids: string[]) => {
    try {
      const result = await window.api.bulkDeleteTransactions(ids) as BulkDeleteResult;
      const idSet = new Set(ids);
      set((state) => ({
        transactions: state.transactions.filter((t) => !idSet.has(t.id)),
        _generation: state._generation + 1,
      }));
      return result;
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  restoreTransaction: async (data: TransactionRow) => {
    try {
      const result = await window.api.saveTransaction(data);
      set((state) => {
        const exists = state.transactions.some((t) => t.id === result.id);
        if (exists) {
          return {
            transactions: state.transactions.map((t) => (t.id === result.id ? result : t)),
            _generation: state._generation + 1,
          };
        }
        return {
          transactions: [result, ...state.transactions],
          _generation: state._generation + 1,
        };
      });
      return result;
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  bulkRestore: async (data: TransactionRow[]) => {
    try {
      const results = await window.api.bulkSaveTransactions(data);
      const resultMap = new Map(results.map((r) => [r.id, r]));
      set((state) => {
        const existingIds = new Set(state.transactions.map((t) => t.id));
        const updated = state.transactions.map((t) => resultMap.get(t.id) ?? t);
        const added = results.filter((r) => !existingIds.has(r.id));
        return {
          transactions: [...added, ...updated],
          _generation: state._generation + 1,
        };
      });
      return results;
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },
}));
