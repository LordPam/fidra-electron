import { create } from 'zustand';
import type { InvoiceRow } from '../../shared/ipc-types';

interface InvoiceState {
  invoices: InvoiceRow[];
  loading: boolean;
  error: string | null;

  loadAll: () => Promise<void>;
  save: (data: InvoiceRow) => Promise<InvoiceRow>;
  remove: (id: string) => Promise<boolean>;
  markPaid: (invoiceId: string, transactionId: string) => Promise<InvoiceRow | null>;
  revertToDraft: (invoiceId: string) => Promise<InvoiceRow | null>;
}

export const useInvoiceStore = create<InvoiceState>((set) => ({
  invoices: [],
  loading: false,
  error: null,

  loadAll: async () => {
    set({ loading: true, error: null });
    try {
      const rows = await window.api.getInvoices();
      set({ invoices: rows, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  save: async (data: InvoiceRow) => {
    try {
      const result = await window.api.saveInvoice(data);
      set((state) => {
        const exists = state.invoices.some((inv) => inv.id === result.id);
        if (exists) {
          return { invoices: state.invoices.map((inv) => (inv.id === result.id ? result : inv)) };
        }
        return { invoices: [result, ...state.invoices] };
      });
      return result;
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  remove: async (id: string) => {
    try {
      const success = await window.api.deleteInvoice(id);
      if (success) {
        set((state) => ({
          invoices: state.invoices.filter((inv) => inv.id !== id),
        }));
      }
      return success;
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  markPaid: async (invoiceId: string, transactionId: string) => {
    try {
      const result = await window.api.markInvoicePaid(invoiceId, transactionId);
      if (result) {
        set((state) => ({
          invoices: state.invoices.map((inv) => (inv.id === result.id ? result : inv)),
        }));
      }
      return result;
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  revertToDraft: async (invoiceId: string) => {
    try {
      const result = await window.api.revertInvoiceToDraft(invoiceId);
      if (result) {
        set((state) => ({
          invoices: state.invoices.map((inv) => (inv.id === result.id ? result : inv)),
        }));
      }
      return result;
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },
}));
