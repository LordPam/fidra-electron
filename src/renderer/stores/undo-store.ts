import { create } from 'zustand';
import type { UndoCommand } from '../services/undo';

const MAX_UNDO = 50;

interface UndoState {
  undoStack: UndoCommand[];
  redoStack: UndoCommand[];

  execute: (command: UndoCommand) => Promise<void>;
  record: (command: UndoCommand) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  clear: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  undoDescription: () => string | null;
  redoDescription: () => string | null;
}

export const useUndoStore = create<UndoState>((set, get) => ({
  undoStack: [],
  redoStack: [],

  execute: async (command: UndoCommand) => {
    await command.execute();
    set((state) => ({
      undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), command],
      redoStack: [],
    }));
  },

  record: (command: UndoCommand) => {
    set((state) => ({
      undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), command],
      redoStack: [],
    }));
  },

  undo: async () => {
    const { undoStack } = get();
    if (undoStack.length === 0) return;
    const command = undoStack[undoStack.length - 1];
    await command.undo();
    set((state) => ({
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, command],
    }));
  },

  redo: async () => {
    const { redoStack } = get();
    if (redoStack.length === 0) return;
    const command = redoStack[redoStack.length - 1];
    await command.execute();
    set((state) => ({
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, command],
    }));
  },

  clear: () => set({ undoStack: [], redoStack: [] }),

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,

  undoDescription: () => {
    const { undoStack } = get();
    return undoStack.length > 0 ? undoStack[undoStack.length - 1].description : null;
  },

  redoDescription: () => {
    const { redoStack } = get();
    return redoStack.length > 0 ? redoStack[redoStack.length - 1].description : null;
  },
}));
