import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  reasons: new Map<number, string | null>(),
  ignoreReplies: false,
  windows: [] as any[],
  state: { phase: 'ready', automatic: true, installerReady: true } as any,
  quit: vi.fn(), openPath: vi.fn(), openExternal: vi.fn(), closeAll: vi.fn(), confirm: vi.fn(),
  saveSettings: vi.fn(), verifiedInstaller: vi.fn(), check: vi.fn(), download: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/fidra-test', getVersion: () => '0.1.23', isPackaged: true, quit: mocks.quit, once: vi.fn() },
  BrowserWindow: { getAllWindows: () => mocks.windows, fromWebContents: () => mocks.windows[0], getFocusedWindow: () => mocks.windows[0] },
  ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(name, handler) },
  dialog: { showMessageBox: mocks.confirm }, shell: { openPath: mocks.openPath, openExternal: mocks.openExternal },
  powerMonitor: { on: vi.fn(), removeListener: vi.fn() },
}));
vi.mock('node:fs', () => ({ default: { existsSync: () => true, readFileSync: () => 'public key' } }));
vi.mock('../../ipc/context-resolver', () => ({ resolveContext: () => ({}) }));
vi.mock('../../window/global-settings', () => ({ loadGlobalSettings: () => ({}), saveGlobalSettings: mocks.saveSettings }));
vi.mock('../../window/window-manager', () => ({ getWindowManager: () => ({
  setUpdatePreparing: vi.fn(), closeAll: mocks.closeAll, getAllContexts: () => mocks.windows.map((window) => ({ dbPath: `/ledgers/${window.webContents.id}.fdra` })),
}) }));
vi.mock('../verified-updater', () => ({ VerifiedUpdater: class {
  initialize = async () => mocks.state;
  getStatus = () => mocks.state;
  verifiedInstaller = mocks.verifiedInstaller;
  setPreparing = (preparing: boolean) => { mocks.state.phase = preparing ? 'preparing' : 'ready'; };
  fail = (error: Error) => ({ ...mocks.state, phase: 'error', error: error.message });
  check = mocks.check;
  download = mocks.download;
  setAutomatic = async (automatic: boolean) => { mocks.state.automatic = automatic; return mocks.state; };
  remindLater = async () => mocks.state;
} }));
import { checkForUpdates, registerUpdateHandlers } from '../update-checker';

function windowFor(id: number) {
  return { isDestroyed: () => false, webContents: { id, once: vi.fn(), removeListener: vi.fn(), send: vi.fn((channel, requestId) => {
    if (channel === 'updates:prepare' && !mocks.ignoreReplies) queueMicrotask(() => mocks.handlers.get('updates:prepared')!({ sender: { id } }, { requestId, reason: mocks.reasons.get(id) ?? null }));
  }) } };
}
function install() { return mocks.handlers.get('updates:openInstaller')!({ sender: { id: 1 } }); }
beforeEach(() => {
  Object.defineProperty(process, 'resourcesPath', { value: '/test/resources', configurable: true });
  vi.clearAllMocks();
  mocks.handlers.clear(); mocks.reasons.clear(); mocks.ignoreReplies = false;
  mocks.windows = [windowFor(1), windowFor(2)];
  mocks.state = { phase: 'ready', automatic: true, installerReady: true };
  mocks.confirm.mockResolvedValue({ response: 1 }); mocks.openPath.mockResolvedValue('');
  mocks.closeAll.mockResolvedValue(undefined); mocks.verifiedInstaller.mockResolvedValue('/verified/installer.dmg');
  mocks.check.mockImplementation(async () => mocks.state); mocks.download.mockImplementation(async () => mocks.state);
  registerUpdateHandlers();
});
afterEach(() => vi.useRealTimers());

describe('installer handoff', () => {
  it('waits for every window, rechecks the installer, records ledger paths and closes databases before quitting', async () => {
    await install();
    expect(mocks.windows.every((window) => window.webContents.send.mock.calls.some(([channel]: [string]) => channel === 'updates:prepare'))).toBe(true);
    expect(mocks.verifiedInstaller).toHaveBeenCalledTimes(2);
    expect(mocks.saveSettings).toHaveBeenCalledWith({ updateReopenPaths: ['/ledgers/1.fdra', '/ledgers/2.fdra'] }, true);
    expect(mocks.openPath.mock.invocationCallOrder[0]).toBeLessThan(mocks.closeAll.mock.invocationCallOrder[0]);
    expect(mocks.closeAll.mock.invocationCallOrder[0]).toBeLessThan(mocks.quit.mock.invocationCallOrder[0]);
  });
  it('does not close anything when the user cancels', async () => {
    mocks.confirm.mockResolvedValue({ response: 0 }); await install();
    expect(mocks.openPath).not.toHaveBeenCalled(); expect(mocks.quit).not.toHaveBeenCalled();
  });
  it('keeps ALL windows open when another window has unfinished work', async () => {
    mocks.reasons.set(2, 'Finish the transaction in the other window.');
    expect((await install()).error).toMatch(/other window/);
    expect(mocks.openPath).not.toHaveBeenCalled(); expect(mocks.closeAll).not.toHaveBeenCalled();
    expect(mocks.windows[0].webContents.send).toHaveBeenCalledWith('updates:cancelPreparation', undefined);
  });
  it('unfreezes the windows if opening the installer fails', async () => {
    mocks.openPath.mockResolvedValue('Permission denied');
    expect((await install()).error).toMatch(/Permission denied/);
    expect(mocks.closeAll).not.toHaveBeenCalled(); expect(mocks.quit).not.toHaveBeenCalled();
  });
  it('fails closed when a window never acknowledges preparation', async () => {
    vi.useFakeTimers(); mocks.ignoreReplies = true;
    const result = install();
    await vi.advanceTimersByTimeAsync(20_001);
    expect((await result).error).toMatch(/did not finish/);
    expect(mocks.quit).not.toHaveBeenCalled();
  });
  it('does not install a modified or missing cached installer', async () => {
    mocks.verifiedInstaller.mockRejectedValue(new Error('Verification failed'));
    expect((await install()).error).toBe('Verification failed');
    expect(mocks.confirm).not.toHaveBeenCalled(); expect(mocks.openPath).not.toHaveBeenCalled();
  });
  it('validates IPC preferences instead of coercing arbitrary input', async () => {
    await expect(mocks.handlers.get('updates:setAutomatic')!({}, 'yes')).rejects.toThrow();
    expect((await mocks.handlers.get('updates:setAutomatic')!({}, false)).automatic).toBe(false);
  });
  it('respects manual-only settings during background checks', async () => {
    mocks.state.automatic = false; await checkForUpdates();
    expect(mocks.check).not.toHaveBeenCalled();
    await checkForUpdates(false);
    expect(mocks.check).toHaveBeenCalledOnce(); expect(mocks.download).not.toHaveBeenCalled();
  });
});
