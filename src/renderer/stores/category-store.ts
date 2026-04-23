import { create } from 'zustand';

interface CategoryState {
  incomeCategories: string[];
  expenseCategories: string[];
  loading: boolean;
  error: string | null;
  _generation: number;

  loadAll: () => Promise<void>;
  silentRefresh: () => Promise<void>;
  setCategories: (type: 'income' | 'expense', names: string[]) => Promise<void>;
}

export const useCategoryStore = create<CategoryState>((set, get) => ({
  incomeCategories: [],
  expenseCategories: [],
  loading: false,
  error: null,
  _generation: 0,

  loadAll: async () => {
    set({ loading: true, error: null });
    try {
      const [income, expense] = await Promise.all([
        window.api.getCategories('income'),
        window.api.getCategories('expense'),
      ]);
      set({ incomeCategories: income, expenseCategories: expense, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  silentRefresh: async () => {
    try {
      const gen = get()._generation;
      const [income, expense] = await Promise.all([
        window.api.getCategories('income'),
        window.api.getCategories('expense'),
      ]);
      if (gen !== get()._generation) return;
      const state = get();
      const incomeUnchanged = state.incomeCategories.length === income.length && state.incomeCategories.every((c, i) => c === income[i]);
      const expenseUnchanged = state.expenseCategories.length === expense.length && state.expenseCategories.every((c, i) => c === expense[i]);
      if (incomeUnchanged && expenseUnchanged) return;
      set({ incomeCategories: income, expenseCategories: expense });
    } catch (e) {
      console.warn('[CategoryStore] silentRefresh failed:', e);
    }
  },

  setCategories: async (type: 'income' | 'expense', names: string[]) => {
    try {
      await window.api.setCategories(type, names);
      if (type === 'income') {
        set((state) => ({ incomeCategories: names, _generation: state._generation + 1 }));
      } else {
        set((state) => ({ expenseCategories: names, _generation: state._generation + 1 }));
      }
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },
}));
