import { create } from 'zustand';

interface WindowState {
  dbPath: string;
  dbName: string;
  loaded: boolean;
  loadDbInfo: () => Promise<void>;
}

export const useWindowStore = create<WindowState>((set) => ({
  dbPath: '',
  dbName: '',
  loaded: false,

  loadDbInfo: async () => {
    try {
      const info = await window.api.getDbInfo();
      set({ dbPath: info.path, dbName: info.name, loaded: true });
    } catch (e) {
      console.error('Failed to load DB info:', e);
    }
  },
}));
