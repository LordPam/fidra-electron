import { create } from 'zustand';
import type { SheetRow } from '../../shared/ipc-types';

interface SheetState {
  sheets: SheetRow[];
  currentSheet: string;
  loading: boolean;
  error: string | null;
  _generation: number;

  loadAll: () => Promise<void>;
  silentRefresh: () => Promise<void>;
  setCurrent: (name: string) => void;
  addSheet: (id: string, name: string) => Promise<SheetRow>;
  renameSheet: (oldName: string, newName: string) => Promise<void>;
  removeSheet: (id: string, name: string, mergeTarget?: string) => Promise<void>;
  reorderSheets: (orderedIds: string[]) => Promise<void>;
}

export const useSheetStore = create<SheetState>((set, get) => ({
  sheets: [],
  currentSheet: 'All Sheets',
  loading: false,
  error: null,
  _generation: 0,

  loadAll: async () => {
    set({ loading: true, error: null });
    try {
      let rows = await window.api.getSheets();
      if (rows.length === 0) {
        const defaultSheet = await window.api.createSheet(crypto.randomUUID(), 'General');
        rows = [defaultSheet];
      }
      // Restore persisted sheet selection from per-database settings
      const persisted = await window.api.getCurrentSheet();
      const currentSheet = persisted !== 'All Sheets' && !rows.some((s) => s.name === persisted)
        ? 'All Sheets'
        : persisted;
      set({ sheets: rows, loading: false, currentSheet });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  silentRefresh: async () => {
    try {
      const gen = get()._generation;
      const rows = await window.api.getSheets();
      if (gen !== get()._generation) return;
      if (rows.length > 0) {
        const current = get().sheets;
        if (current.length === rows.length && current.every((s, i) => s.id === rows[i].id && s.name === rows[i].name)) {
          return;
        }
        set({ sheets: rows });
      }
    } catch (e) {
      console.warn('[SheetStore] silentRefresh failed:', e);
    }
  },

  setCurrent: (name: string) => {
    set({ currentSheet: name });
    window.api.saveCurrentSheet(name);
  },

  addSheet: async (id: string, name: string) => {
    try {
      const result = await window.api.createSheet(id, name);
      set((state) => ({
        sheets: [...state.sheets, result],
        _generation: state._generation + 1,
      }));
      return result;
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  renameSheet: async (oldName: string, newName: string) => {
    try {
      await window.api.renameSheet(oldName, newName);
      set((state) => {
        const newCurrent = state.currentSheet === oldName ? newName : state.currentSheet;
        return {
          sheets: state.sheets.map((s) => (s.name === oldName ? { ...s, name: newName } : s)),
          currentSheet: newCurrent,
          _generation: state._generation + 1,
        };
      });
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  removeSheet: async (id: string, name: string, mergeTarget?: string) => {
    try {
      await window.api.deleteSheet(id, name, mergeTarget);
      set((state) => {
        const newCurrent = state.currentSheet === name ? 'All Sheets' : state.currentSheet;
        return {
          sheets: state.sheets.filter((s) => s.id !== id),
          currentSheet: newCurrent,
          _generation: state._generation + 1,
        };
      });
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  reorderSheets: async (orderedIds: string[]) => {
    try {
      await window.api.reorderSheets(orderedIds);
      set((state) => {
        const byId = new Map(state.sheets.map((s) => [s.id, s]));
        const reordered = orderedIds
          .map((id) => byId.get(id))
          .filter((s): s is SheetRow => !!s);
        return {
          sheets: reordered,
          _generation: state._generation + 1,
        };
      });
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },
}));
