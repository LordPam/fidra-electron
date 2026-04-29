import type { ElectronApi } from '../../preload/preload';
import type {
  AttachmentRow,
  CloudServerConfig,
  InvoiceDefaults,
  InvoiceRow,
  PlannedTemplateRow,
  SheetRow,
  TransactionRow,
} from '../../shared/ipc-types';
import { createDemoDataState } from './fixtures';

type DemoCurrentUser = { displayName: string; source: 'auth' | 'profile' | 'none' } | null;

const noopUnsubscribe = () => {};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function sortSheets(rows: SheetRow[]): SheetRow[] {
  return [...rows].sort((a, b) => a.sort_order - b.sort_order);
}

function isListenerName(name: string): boolean {
  return name.startsWith('on');
}

export function createDemoApi(): ElectronApi {
  const state = createDemoDataState();

  const upsertTransaction = (row: TransactionRow): TransactionRow => {
    const next = { ...row };
    const index = state.transactions.findIndex((existing) => existing.id === row.id);
    if (index >= 0) {
      state.transactions[index] = next;
    } else {
      state.transactions.unshift(next);
    }
    return next;
  };

  const upsertTemplate = (row: PlannedTemplateRow): PlannedTemplateRow => {
    const next = { ...row };
    const index = state.plannedTemplates.findIndex((existing) => existing.id === row.id);
    if (index >= 0) {
      state.plannedTemplates[index] = next;
    } else {
      state.plannedTemplates.unshift(next);
    }
    return next;
  };

  const upsertInvoice = (row: InvoiceRow): InvoiceRow => {
    const next = { ...row };
    const index = state.invoices.findIndex((existing) => existing.id === row.id);
    if (index >= 0) {
      state.invoices[index] = next;
    } else {
      state.invoices.unshift(next);
    }
    return next;
  };

  const getCurrentUser = (): DemoCurrentUser => {
    if (state.currentUser) return clone(state.currentUser);
    if (state.profile.name.trim()) {
      return { displayName: state.profile.name.trim(), source: 'profile' };
    }
    return null;
  };

  const implemented = {
    getTransactions: async (sheet?: string) =>
      clone(sheet ? state.transactions.filter((row) => row.sheet === sheet) : state.transactions),

    getTransaction: async (id: string) =>
      clone(state.transactions.find((row) => row.id === id) ?? null),

    saveTransaction: async (row: TransactionRow) => clone(upsertTransaction(row)),

    deleteTransaction: async (id: string) => {
      const deletedAttachments = state.attachments.filter((row) => row.transaction_id === id);
      state.attachments = state.attachments.filter((row) => row.transaction_id !== id);
      state.transactions = state.transactions.filter((row) => row.id !== id);
      return clone({ success: true, deletedAttachments });
    },

    bulkSaveTransactions: async (rows: TransactionRow[]) => clone(rows.map(upsertTransaction)),

    bulkDeleteTransactions: async (ids: string[]) => {
      const idSet = new Set(ids);
      const deletedAttachments: Record<string, AttachmentRow[]> = {};
      for (const id of ids) {
        deletedAttachments[id] = state.attachments.filter((row) => row.transaction_id === id);
      }
      state.attachments = state.attachments.filter((row) => !idSet.has(row.transaction_id));
      state.transactions = state.transactions.filter((row) => !idSet.has(row.id));
      return clone({ count: ids.length, deletedAttachments });
    },

    getSheets: async () => clone(sortSheets(state.sheets)),

    createSheet: async (id: string, name: string) => {
      const row: SheetRow = {
        id,
        name,
        is_virtual: 0,
        is_planned: 0,
        sort_order: state.sheets.length + 1,
        created_at: new Date().toISOString(),
      };
      state.sheets.push(row);
      return clone(row);
    },

    renameSheet: async (oldName: string, newName: string) => {
      state.sheets = state.sheets.map((row) => (row.name === oldName ? { ...row, name: newName } : row));
      state.transactions = state.transactions.map((row) => (row.sheet === oldName ? { ...row, sheet: newName } : row));
      state.plannedTemplates = state.plannedTemplates.map((row) => (
        row.target_sheet === oldName ? { ...row, target_sheet: newName } : row
      ));
      if (state.currentSheet === oldName) state.currentSheet = newName;
    },

    deleteSheet: async (id: string, name: string, mergeTarget?: string) => {
      state.sheets = state.sheets.filter((row) => row.id !== id);
      if (mergeTarget) {
        state.transactions = state.transactions.map((row) => (
          row.sheet === name ? { ...row, sheet: mergeTarget } : row
        ));
        state.plannedTemplates = state.plannedTemplates.map((row) => (
          row.target_sheet === name ? { ...row, target_sheet: mergeTarget } : row
        ));
      } else {
        state.transactions = state.transactions.filter((row) => row.sheet !== name);
        state.plannedTemplates = state.plannedTemplates.filter((row) => row.target_sheet !== name);
      }
      if (state.currentSheet === name) state.currentSheet = 'All Sheets';
    },

    reorderSheets: async (orderedIds: string[]) => {
      const byId = new Map(state.sheets.map((row) => [row.id, row]));
      state.sheets = orderedIds
        .map((id, index) => {
          const row = byId.get(id);
          return row ? { ...row, sort_order: index + 1 } : null;
        })
        .filter((row): row is SheetRow => row !== null);
    },

    deleteSheetSimple: async (id: string) => {
      state.sheets = state.sheets.filter((row) => row.id !== id);
      return true;
    },

    restoreSheetWithSort: async (row: SheetRow) => {
      const restored = { ...row };
      state.sheets.push(restored);
      return clone(restored);
    },

    getTransactionsOnSheet: async (name: string) =>
      clone(state.transactions.filter((row) => row.sheet === name)),

    getPlannedOnSheet: async (name: string) =>
      clone(state.plannedTemplates.filter((row) => row.target_sheet === name)),

    getAttachmentsOnSheet: async (name: string) => {
      const ids = new Set(state.transactions.filter((row) => row.sheet === name).map((row) => row.id));
      return clone(state.attachments.filter((row) => ids.has(row.transaction_id)));
    },

    getCategories: async (type: string) =>
      clone(type === 'income' ? state.incomeCategories : state.expenseCategories),

    setCategories: async (type: string, names: string[]) => {
      if (type === 'income') {
        state.incomeCategories = [...names];
      } else {
        state.expenseCategories = [...names];
      }
    },

    getPlannedTemplates: async () => clone(state.plannedTemplates),

    savePlannedTemplate: async (row: PlannedTemplateRow) => clone(upsertTemplate(row)),

    bulkSavePlannedTemplates: async (rows: PlannedTemplateRow[]) => clone(rows.map(upsertTemplate)),

    deletePlannedTemplate: async (id: string) => {
      state.plannedTemplates = state.plannedTemplates.filter((row) => row.id !== id);
      return true;
    },

    getActivityNotes: async () => clone(state.activityNotes),

    saveActivityNote: async (activity: string, notes: string) => {
      state.activityNotes = { ...state.activityNotes, [activity]: notes };
    },

    deleteActivityNote: async (activity: string) => {
      const next = { ...state.activityNotes };
      delete next[activity];
      state.activityNotes = next;
    },

    getAttachments: async (transactionId: string) =>
      clone(state.attachments.filter((row) => row.transaction_id === transactionId)),

    getAttachmentCounts: async (transactionIds: string[]) => {
      const idSet = new Set(transactionIds);
      const counts: Record<string, number> = {};
      for (const row of state.attachments) {
        if (!idSet.has(row.transaction_id)) continue;
        counts[row.transaction_id] = (counts[row.transaction_id] ?? 0) + 1;
      }
      return counts;
    },

    addAttachment: async (transactionId: string, filePath: string, filename: string) => {
      const row: AttachmentRow = {
        id: crypto.randomUUID(),
        transaction_id: transactionId,
        filename,
        stored_name: filePath.split('/').pop() ?? filename,
        mime_type: null,
        file_size: 0,
        created_at: new Date().toISOString(),
      };
      state.attachments.push(row);
      return clone(row);
    },

    removeAttachment: async (id: string) => {
      state.attachments = state.attachments.filter((row) => row.id !== id);
      return true;
    },

    openAttachment: async () => true,

    restoreAttachment: async (row: AttachmentRow) => {
      state.attachments.push({ ...row });
      return clone(row);
    },

    restoreAttachmentsForTransaction: async (rows: AttachmentRow[]) => {
      state.attachments.push(...rows.map((row) => ({ ...row })));
    },

    getPathForFile: (file: File) => file.name,

    showOpenDialog: async () => ({ filePaths: [], canceled: true }),

    showSaveDialog: async () => ({ filePath: undefined, canceled: true }),

    writeFile: async () => undefined,

    writeFileBinary: async () => undefined,

    printToPDF: async () => [],

    getCloudConfig: async (): Promise<CloudServerConfig | null> => clone(state.cloudConfig),

    saveCloudConfig: async (config: CloudServerConfig) => {
      state.cloudConfig = clone(config);
    },

    deleteCloudConfig: async () => {
      state.cloudConfig = null;
    },

    testCloudConnection: async () => ({ success: false, error: 'Cloud sync is disabled in the browser demo.' }),

    connectCloud: async () => ({ success: false, error: 'Cloud sync is disabled in the browser demo.' }),

    disconnectCloud: async () => undefined,

    getCloudStatus: async () => clone(state.cloudStatus),

    syncNow: async () => 0,

    getSyncStatus: async () => ({ isSyncing: false, pendingCount: 0, conflicts: [] }),

    resolveConflict: async () => undefined,

    getConnectionStatus: async () => ({ status: 'offline' as const }),

    reconnectCloud: async () => ({ success: false }),

    getStartupMode: async () => ({ mode: 'restore' as const }),

    markFirstRunComplete: async () => undefined,

    createWindow: async () => ({ success: false, error: 'Not available in browser demo.' }),

    openFileDialog: async () => ({ filePath: null, canceled: true }),

    createNewDb: async () => ({ filePath: null, canceled: true }),

    getRecentFiles: async () => [],

    openRecentFile: async () => ({ success: false, error: 'Not available in browser demo.' }),

    removeRecentFile: async () => undefined,

    getDbInfo: async () => clone(state.dbInfo),

    isCloudWindow: async () => false,

    getCloudServers: async () => [],

    saveCloudServer: async () => undefined,

    removeCloudServer: async () => undefined,

    openCloudServer: async () => ({ success: false, error: 'Not available in browser demo.' }),

    switchToFile: async () => ({ success: false, reloading: false, error: 'Not available in browser demo.' }),

    switchToCloudServer: async () => ({ success: false, reloading: false, error: 'Not available in browser demo.' }),

    getInvoices: async () => clone(state.invoices),

    getInvoicesByPlannedTemplate: async (plannedTemplateId: string) =>
      clone(state.invoices.filter((row) => row.planned_template_id === plannedTemplateId)),

    saveInvoice: async (row: InvoiceRow) => clone(upsertInvoice(row)),

    deleteInvoice: async (id: string) => {
      state.invoices = state.invoices.filter((row) => row.id !== id);
      return true;
    },

    markInvoicePaid: async (invoiceId: string, transactionId: string) => {
      const existing = state.invoices.find((row) => row.id === invoiceId);
      const updated: InvoiceRow = {
        ...(existing ?? state.invoices[0]),
        id: invoiceId,
        transaction_id: transactionId,
        status: 'paid',
        paid_at: new Date().toISOString(),
      };
      return clone(upsertInvoice(updated));
    },

    revertInvoiceToDraft: async (invoiceId: string) => {
      const existing = state.invoices.find((row) => row.id === invoiceId);
      const updated: InvoiceRow = {
        ...(existing ?? state.invoices[0]),
        id: invoiceId,
        transaction_id: null,
        status: 'draft',
        paid_at: null,
      };
      return clone(upsertInvoice(updated));
    },

    readFileBase64: async () => '',

    getProfile: async () => clone(state.profile),

    saveProfile: async (profile: { name: string; initials: string }) => {
      state.profile = clone(profile);
    },

    getCurrentUser: async () => clone(getCurrentUser()),

    getTransactionSettings: async () => ({ dateOnApprove: false, dateOnPlannedConversion: false }),

    saveTransactionSettings: async () => undefined,

    getFYStartMonth: async () => state.fyStartMonth,

    saveFYStartMonth: async (month: number) => {
      state.fyStartMonth = month;
    },

    getCurrentSheet: async () => state.currentSheet,

    saveCurrentSheet: async (name: string) => {
      state.currentSheet = name;
    },

    getInvoiceDefaults: async (): Promise<InvoiceDefaults> => clone(state.invoiceDefaults),

    saveInvoiceDefaults: async (defaults: InvoiceDefaults) => {
      state.invoiceDefaults = clone(defaults);
    },

    getUiPreferences: async () => clone(state.uiPreferences),

    saveUiPreferences: async (prefs: Record<string, unknown>) => {
      state.uiPreferences = {
        ...state.uiPreferences,
        ...prefs,
      };
    },

    authSignIn: async () => ({ success: false, error: 'Authentication is disabled in the browser demo.' }),
    authSignUp: async () => ({ success: false, error: 'Authentication is disabled in the browser demo.' }),
    authSignOut: async () => undefined,
    authGetSession: async () => null,
    authGetOAuthUrl: async () => ({ error: 'Authentication is disabled in the browser demo.' }),
    authOAuthCallback: async () => ({ success: false, error: 'Authentication is disabled in the browser demo.' }),
    authAdminFirstSetup: async () => ({ success: false, error: 'Authentication is disabled in the browser demo.' }),
    getPersonnel: async () => [],
    invitePersonnel: async () => {
      throw new Error('Personnel management is disabled in the browser demo.');
    },
    removePersonnel: async () => ({ success: false, error: 'Disabled in browser demo.' }),
    updatePersonnelRole: async () => ({ success: false, error: 'Disabled in browser demo.' }),
    localAuthGetStatus: async () => ({
      authEnabled: false,
      isAuthenticated: false,
      personnel: null,
      isAdmin: false,
    }),
    localAuthSignIn: async () => ({ success: false, error: 'Disabled in browser demo.' }),
    localAuthCreateFirstAdmin: async () => ({ success: false, error: 'Disabled in browser demo.' }),
    localAuthInviteMember: async () => ({ success: false, error: 'Disabled in browser demo.' }),
    localAuthChangePassword: async () => ({ success: false, error: 'Disabled in browser demo.' }),
    localAuthSignOut: async () => undefined,

    localSyncGetStatus: async () => clone(state.localSyncStatus),
    localSyncGetConfig: async () => clone(state.localSyncConfig),
    localSyncConfigure: async () => ({ success: false, error: 'Local Sync is disabled in the browser demo.' }),
    localSyncDisconnect: async () => undefined,
    localSyncExportNow: async () => undefined,
    localSyncImportNow: async () => undefined,
    localSyncGetConflicts: async () => [],
    localSyncResolveConflict: async () => ({ success: false }),
    localSyncValidateFolder: async () => ({ valid: true as const }),
    localSyncCreateSnapshot: async () => ({ success: false, error: 'Disabled in browser demo.' }),
    localSyncRecoverAttachments: async () => ({ success: false, restored: 0, error: 'Disabled in browser demo.' }),
    localSyncMigrateFromCloud: async () => ({ success: false, error: 'Disabled in browser demo.' }),
    localSyncJoinGroup: async () => ({ success: false, error: 'Disabled in browser demo.' }),
    localSyncJoinViaInvite: async () => ({ success: false, error: 'Disabled in browser demo.' }),
    localSyncGetStartupSummary: async () => null,

    backupList: async () => [],
    backupGetSettings: async () => ({
      backupDir: null,
      retentionCount: 10,
      autoBackupOnClose: false,
    }),
    backupCreate: async () => undefined,
    backupRestore: async () => ({ success: false, error: 'Disabled in browser demo.' }),
    backupDelete: async () => undefined,
    backupSaveSettings: async () => undefined,
  };

  return new Proxy(implemented, {
    get(target, prop, receiver) {
      if (Reflect.has(target, prop)) {
        return Reflect.get(target, prop, receiver);
      }
      if (typeof prop === 'string') {
        if (isListenerName(prop)) {
          return () => noopUnsubscribe;
        }
        return (...args: unknown[]) => {
          console.warn(`[demo-api] Unimplemented call: ${prop}`, args);
          return Promise.resolve(undefined);
        };
      }
      return undefined;
    },
  }) as unknown as ElectronApi;
}
