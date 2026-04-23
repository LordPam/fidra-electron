import { create } from 'zustand';
import type { PlannedTemplateRow } from '../../shared/ipc-types';

interface PlannedState {
  templates: PlannedTemplateRow[];
  loading: boolean;
  error: string | null;
  _generation: number;

  loadAll: () => Promise<void>;
  silentRefresh: () => Promise<void>;
  addTemplate: (data: PlannedTemplateRow) => Promise<PlannedTemplateRow>;
  updateTemplate: (data: PlannedTemplateRow) => Promise<PlannedTemplateRow>;
  bulkUpdateTemplates: (data: PlannedTemplateRow[]) => Promise<PlannedTemplateRow[]>;
  removeTemplate: (id: string) => Promise<boolean>;
  restoreTemplate: (data: PlannedTemplateRow) => Promise<PlannedTemplateRow>;
}

export const usePlannedStore = create<PlannedState>((set, get) => ({
  templates: [],
  loading: false,
  error: null,
  _generation: 0,

  loadAll: async () => {
    set({ loading: true, error: null });
    try {
      const rows = await window.api.getPlannedTemplates();
      set({ templates: rows, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  silentRefresh: async () => {
    try {
      const gen = get()._generation;
      const rows = await window.api.getPlannedTemplates();
      if (gen !== get()._generation) return;
      const current = get().templates;
      if (current.length === rows.length && current.every((t, i) => t.id === rows[i].id && t.version === rows[i].version)) {
        return;
      }
      set({ templates: rows });
    } catch (e) {
      console.warn('[PlannedStore] silentRefresh failed:', e);
    }
  },

  addTemplate: async (data: PlannedTemplateRow) => {
    try {
      const result = await window.api.savePlannedTemplate(data);
      set((state) => ({
        templates: [...state.templates, result].sort((a, b) => a.start_date.localeCompare(b.start_date)),
        _generation: state._generation + 1,
      }));
      return result;
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  updateTemplate: async (data: PlannedTemplateRow) => {
    try {
      const result = await window.api.savePlannedTemplate(data);
      set((state) => ({
        templates: state.templates.map((t) => (t.id === result.id ? result : t)),
        _generation: state._generation + 1,
      }));
      return result;
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  bulkUpdateTemplates: async (data: PlannedTemplateRow[]) => {
    try {
      const results = await window.api.bulkSavePlannedTemplates(data);
      const resultMap = new Map(results.map((r) => [r.id, r]));
      set((state) => ({
        templates: state.templates.map((t) => resultMap.get(t.id) ?? t),
        _generation: state._generation + 1,
      }));
      return results;
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  removeTemplate: async (id: string) => {
    try {
      const success = await window.api.deletePlannedTemplate(id);
      if (success) {
        set((state) => ({
          templates: state.templates.filter((t) => t.id !== id),
          _generation: state._generation + 1,
        }));
      }
      return success;
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  restoreTemplate: async (data: PlannedTemplateRow) => {
    try {
      const result = await window.api.savePlannedTemplate(data);
      set((state) => {
        const exists = state.templates.some((t) => t.id === result.id);
        if (exists) {
          return {
            templates: state.templates.map((t) => (t.id === result.id ? result : t)),
            _generation: state._generation + 1,
          };
        }
        return {
          templates: [...state.templates, result].sort((a, b) => a.start_date.localeCompare(b.start_date)),
          _generation: state._generation + 1,
        };
      });
      return result;
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },
}));
