import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useUndoStore } from '../undo-store';
import type { UndoCommand } from '../../services/undo';

/**
 * The command factories in services/undo.ts are thin wrappers over `window.api`
 * and the domain stores; what carries the risk is the stack itself, which is pure
 * state and testable directly.
 */

function command(description: string, log: string[] = []): UndoCommand {
  return {
    description,
    execute: vi.fn(async () => { log.push(`do:${description}`); }),
    undo: vi.fn(async () => { log.push(`undo:${description}`); }),
  };
}

beforeEach(() => {
  useUndoStore.getState().clear();
});

describe('execute', () => {
  it('runs the command and makes it undoable', async () => {
    const log: string[] = [];
    const cmd = command('Add transaction', log);

    await useUndoStore.getState().execute(cmd);

    expect(log).toEqual(['do:Add transaction']);
    expect(useUndoStore.getState().canUndo()).toBe(true);
    expect(useUndoStore.getState().undoDescription()).toBe('Add transaction');
  });

  it('does not record a command that failed', async () => {
    const cmd: UndoCommand = {
      description: 'Doomed',
      execute: vi.fn(async () => { throw new Error('nope'); }),
      undo: vi.fn(),
    };

    await expect(useUndoStore.getState().execute(cmd)).rejects.toThrow('nope');

    // Undoing something that never happened would be worse than losing the entry
    expect(useUndoStore.getState().canUndo()).toBe(false);
  });

  it('drops the redo stack once a new action happens', async () => {
    await useUndoStore.getState().execute(command('First'));
    await useUndoStore.getState().undo();
    expect(useUndoStore.getState().canRedo()).toBe(true);

    await useUndoStore.getState().execute(command('Second'));

    expect(useUndoStore.getState().canRedo()).toBe(false);
  });

  it('keeps at most 50 entries, discarding the oldest', async () => {
    for (let i = 0; i < 55; i++) {
      await useUndoStore.getState().execute(command(`Action ${i}`));
    }

    const { undoStack } = useUndoStore.getState();
    expect(undoStack).toHaveLength(50);
    expect(undoStack[0].description).toBe('Action 5');
    expect(undoStack[49].description).toBe('Action 54');
  });
});

describe('record', () => {
  it('makes a command undoable without running it', () => {
    const log: string[] = [];

    useUndoStore.getState().record(command('Already done', log));

    expect(log).toEqual([]);
    expect(useUndoStore.getState().undoDescription()).toBe('Already done');
  });
});

describe('undo and redo', () => {
  it('unwinds in reverse order', async () => {
    const log: string[] = [];
    await useUndoStore.getState().execute(command('First', log));
    await useUndoStore.getState().execute(command('Second', log));

    await useUndoStore.getState().undo();
    await useUndoStore.getState().undo();

    expect(log).toEqual(['do:First', 'do:Second', 'undo:Second', 'undo:First']);
    expect(useUndoStore.getState().canUndo()).toBe(false);
  });

  it('replays on redo', async () => {
    const log: string[] = [];
    await useUndoStore.getState().execute(command('First', log));
    await useUndoStore.getState().undo();

    await useUndoStore.getState().redo();

    expect(log).toEqual(['do:First', 'undo:First', 'do:First']);
    expect(useUndoStore.getState().canUndo()).toBe(true);
    expect(useUndoStore.getState().canRedo()).toBe(false);
  });

  it('survives being called on an empty stack', async () => {
    await expect(useUndoStore.getState().undo()).resolves.toBeUndefined();
    await expect(useUndoStore.getState().redo()).resolves.toBeUndefined();
  });

  it('leaves a failed undo on the stack to try again', async () => {
    const cmd: UndoCommand = {
      description: 'Stubborn',
      execute: vi.fn(async () => { /* succeeds */ }),
      undo: vi.fn(async () => { throw new Error('cannot undo'); }),
    };
    await useUndoStore.getState().execute(cmd);

    await expect(useUndoStore.getState().undo()).rejects.toThrow('cannot undo');

    expect(useUndoStore.getState().canUndo()).toBe(true);
    expect(useUndoStore.getState().canRedo()).toBe(false);
  });

  it('reports the descriptions the menu shows', async () => {
    expect(useUndoStore.getState().undoDescription()).toBeNull();
    expect(useUndoStore.getState().redoDescription()).toBeNull();

    await useUndoStore.getState().execute(command('Delete sheet'));
    expect(useUndoStore.getState().undoDescription()).toBe('Delete sheet');

    await useUndoStore.getState().undo();
    expect(useUndoStore.getState().redoDescription()).toBe('Delete sheet');
    expect(useUndoStore.getState().undoDescription()).toBeNull();
  });
});

describe('clear', () => {
  it('empties both stacks', async () => {
    await useUndoStore.getState().execute(command('First'));
    await useUndoStore.getState().undo();

    useUndoStore.getState().clear();

    expect(useUndoStore.getState().canUndo()).toBe(false);
    expect(useUndoStore.getState().canRedo()).toBe(false);
  });
});
