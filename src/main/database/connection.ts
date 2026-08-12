import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { crsqliteExtensionPath as extensionPath } from './native-paths';
import { isCrrInitialized } from '../sync/crr-schema';

const SCHEMA_DDL = `
  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY NOT NULL DEFAULT '',
    date TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    amount TEXT NOT NULL DEFAULT '0',
    type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('income', 'expense')),
    status TEXT NOT NULL DEFAULT '--' CHECK (status IN ('--', 'pending', 'approved', 'rejected', 'planned')),
    sheet TEXT NOT NULL DEFAULT '',
    category TEXT,
    party TEXT,
    reference TEXT,
    activity TEXT,
    notes TEXT,
    linked_id TEXT,
    version INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT '',
    modified_at TEXT,
    modified_by TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
  CREATE INDEX IF NOT EXISTS idx_transactions_sheet ON transactions(sheet);
  CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
  CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);

  CREATE TABLE IF NOT EXISTS planned_templates (
    id TEXT PRIMARY KEY NOT NULL DEFAULT '',
    start_date TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    amount TEXT NOT NULL DEFAULT '0',
    type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('income', 'expense')),
    frequency TEXT NOT NULL DEFAULT 'once' CHECK (frequency IN ('once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
    target_sheet TEXT NOT NULL DEFAULT '',
    category TEXT,
    party TEXT,
    activity TEXT,
    notes TEXT,
    transfer_target_sheet TEXT,
    end_date TEXT,
    occurrence_count INTEGER,
    skipped_dates TEXT DEFAULT '[]',
    fulfilled_dates TEXT DEFAULT '[]',
    version INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_planned_start ON planned_templates(start_date);
  CREATE INDEX IF NOT EXISTS idx_planned_target ON planned_templates(target_sheet);

  CREATE TABLE IF NOT EXISTS sheets (
    id TEXT PRIMARY KEY NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    is_virtual INTEGER DEFAULT 0,
    is_planned INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_sheets_name ON sheets(name);

  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('income', 'expense')),
    name TEXT NOT NULL DEFAULT '',
    sort_order INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_categories_type ON categories(type);

  CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY NOT NULL DEFAULT '',
    transaction_id TEXT NOT NULL DEFAULT '',
    filename TEXT NOT NULL DEFAULT '',
    stored_name TEXT NOT NULL DEFAULT '',
    mime_type TEXT,
    file_size INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_attachments_transaction ON attachments(transaction_id);

  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY NOT NULL DEFAULT '',
    timestamp TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL DEFAULT 'create' CHECK (action IN ('create', 'update', 'delete')),
    entity_type TEXT NOT NULL DEFAULT '',
    entity_id TEXT NOT NULL DEFAULT '',
    user TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    details TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
  CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);

  CREATE TABLE IF NOT EXISTS activity_notes (
    activity TEXT PRIMARY KEY NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL DEFAULT '',
    value TEXT NOT NULL DEFAULT '',
    scope TEXT NOT NULL DEFAULT 'device'
  );

  CREATE TABLE IF NOT EXISTS personnel (
    id TEXT PRIMARY KEY NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    auth_uid TEXT,
    created_at TEXT NOT NULL DEFAULT '',
    invited_by TEXT,
    password_hash TEXT,
    encrypted_passphrase TEXT,
    passphrase_salt TEXT,
    device_id TEXT DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_personnel_email ON personnel(email);

  -- Non-CRR bookkeeping table for Local Sync internal state (watermarks, etc.).
  -- NOT registered as a CRR — writes here must not bump crsql db_version.
  CREATE TABLE IF NOT EXISTS sync_meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY NOT NULL DEFAULT '',
    invoice_number TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL DEFAULT '',
    due_date TEXT NOT NULL DEFAULT '',
    from_name TEXT NOT NULL DEFAULT '',
    from_address TEXT,
    to_name TEXT NOT NULL DEFAULT '',
    to_address TEXT,
    line_items TEXT NOT NULL DEFAULT '[]',
    subtotal TEXT NOT NULL DEFAULT '0',
    notes TEXT,
    bank_details TEXT,
    planned_template_id TEXT,
    status TEXT DEFAULT 'draft',
    transaction_id TEXT,
    paid_at TEXT,
    planned_template_snapshot TEXT,
    version INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT '',
    modified_at TEXT,
    modified_by TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date);
  CREATE INDEX IF NOT EXISTS idx_invoices_planned ON invoices(planned_template_id);
`;

/**
 * Apply all pending schema migrations atomically.
 *
 * Several steps are `CREATE _new` → copy → `DROP` → `RENAME` sequences. Run
 * unwrapped, a crash (or a thrown error from a later step) between the DROP and the
 * RENAME loses the table outright. SQLite DDL is transactional and cr-sqlite's
 * `crsql_as_crr` is safe inside BEGIN/COMMIT, so the whole set runs as one unit:
 * either the database comes out fully migrated or exactly as it went in.
 */
export function runMigrations(sqlite: Database.Database): void {
  sqlite.transaction(() => applyMigrations(sqlite))();
}

function applyMigrations(sqlite: Database.Database): void {
  // Migrate categories from INTEGER AUTOINCREMENT PK to TEXT UUID PK (CRR compatibility)
  const catCols = sqlite.pragma('table_info(categories)') as { name: string; type: string }[];
  const idCol = catCols.find((c) => c.name === 'id');
  if (idCol && idCol.type === 'INTEGER') {
    sqlite.exec(`
      CREATE TABLE categories_new (
        id TEXT PRIMARY KEY NOT NULL DEFAULT '',
        type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('income', 'expense')),
        name TEXT NOT NULL DEFAULT '',
        sort_order INTEGER DEFAULT 0
      );
    `);
    const rows = sqlite.prepare('SELECT type, name, sort_order FROM categories ORDER BY sort_order, rowid').all() as {
      type: string;
      name: string;
      sort_order: number;
    }[];
    const ins = sqlite.prepare('INSERT INTO categories_new (id, type, name, sort_order) VALUES (?, ?, ?, ?)');
    for (const row of rows) {
      ins.run(crypto.randomUUID(), row.type, row.name, row.sort_order);
    }
    sqlite.exec('DROP TABLE categories');
    sqlite.exec('ALTER TABLE categories_new RENAME TO categories');
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_categories_type ON categories(type)');
  }

  // Add sort_order column to sheets if missing (added for sheet reordering)
  const cols = sqlite.pragma('table_info(sheets)') as { name: string }[];
  if (!cols.some((c) => c.name === 'sort_order')) {
    sqlite.exec('ALTER TABLE sheets ADD COLUMN sort_order INTEGER DEFAULT 0');
  }

  // Add status/transaction_id/paid_at columns to invoices if missing
  const invCols = sqlite.pragma('table_info(invoices)') as { name: string }[];
  if (invCols.length > 0 && !invCols.some((c) => c.name === 'status')) {
    sqlite.exec("ALTER TABLE invoices ADD COLUMN status TEXT DEFAULT 'draft'");
    sqlite.exec('ALTER TABLE invoices ADD COLUMN transaction_id TEXT');
    sqlite.exec('ALTER TABLE invoices ADD COLUMN paid_at TEXT');
  }

  // Add planned_template_snapshot column to invoices if missing
  const invCols2 = sqlite.pragma('table_info(invoices)') as { name: string }[];
  if (invCols2.length > 0 && !invCols2.some((c) => c.name === 'planned_template_snapshot')) {
    sqlite.exec('ALTER TABLE invoices ADD COLUMN planned_template_snapshot TEXT');
  }

  // Add version/modified_at/modified_by columns to invoices
  const invCols3 = sqlite.pragma('table_info(invoices)') as { name: string }[];
  if (invCols3.length > 0 && !invCols3.some((c) => c.name === 'version')) {
    sqlite.exec('ALTER TABLE invoices ADD COLUMN version INTEGER DEFAULT 1');
    sqlite.exec('ALTER TABLE invoices ADD COLUMN modified_at TEXT');
    sqlite.exec('ALTER TABLE invoices ADD COLUMN modified_by TEXT');
  }

  // Add scope column to settings if missing (Local Sync: org vs device scope)
  const settCols = sqlite.pragma('table_info(settings)') as { name: string }[];
  if (!settCols.some((c) => c.name === 'scope')) {
    sqlite.exec("ALTER TABLE settings ADD COLUMN scope TEXT NOT NULL DEFAULT 'device'");
    // All existing keys are org-scoped (profile, FY, tx behavior, invoice defaults)
    sqlite.exec("UPDATE settings SET scope = 'org'");
  }

  // CRR-compatible DEFAULT migration: rebuild tables to add DEFAULT on all NOT NULL columns.
  // Guarded by sentinel so it only runs once.
  const sentinel = sqlite.prepare("SELECT value FROM settings WHERE key = '_crr_defaults_applied'").get() as
    | { value: string }
    | undefined;
  if (!sentinel) {
    migrateCrrDefaults(sqlite);
    sqlite.prepare(
      "INSERT INTO settings (key, value, scope) VALUES ('_crr_defaults_applied', '1', 'device')",
    ).run();
  }

  // CRR-compatible PK migration for settings and personnel: these tables were missed in
  // migrateCrrDefaults — their PKs may lack NOT NULL or DEFAULT, which cr-sqlite rejects.
  const pkSentinel = sqlite.prepare("SELECT value FROM settings WHERE key = '_crr_pk_fixed'").get() as
    | { value: string }
    | undefined;
  if (!pkSentinel) {
    migrateCrrPrimaryKeys(sqlite);
    sqlite.prepare(
      "INSERT INTO settings (key, value, scope) VALUES ('_crr_pk_fixed', '1', 'device')",
    ).run();
  }

  // CRR-compatible UNIQUE constraint removal: cr-sqlite forbids unique indices/constraints
  // besides the primary key on CRR tables. Drop UNIQUE from sheets.name, categories(type,name),
  // and personnel.email for existing databases. Guarded by sentinel.
  const uqSentinel = sqlite.prepare("SELECT value FROM settings WHERE key = '_crr_unique_removed'").get() as
    | { value: string }
    | undefined;
  if (!uqSentinel) {
    migrateCrrUniqueConstraints(sqlite);
    sqlite.prepare(
      "INSERT INTO settings (key, value, scope) VALUES ('_crr_unique_removed', '1', 'device')",
    ).run();
  }

  // Add auth columns to personnel if missing (Local Sync auth)
  const persCols = sqlite.pragma('table_info(personnel)') as { name: string }[];
  if (persCols.length > 0 && !persCols.some((c) => c.name === 'password_hash')) {
    sqlite.exec('ALTER TABLE personnel ADD COLUMN password_hash TEXT');
    sqlite.exec('ALTER TABLE personnel ADD COLUMN encrypted_passphrase TEXT');
    sqlite.exec('ALTER TABLE personnel ADD COLUMN passphrase_salt TEXT');
  }

  // Add device_id column to personnel if missing (device→person mapping for sync notifications)
  const persCols2 = sqlite.pragma('table_info(personnel)') as { name: string }[];
  if (persCols2.length > 0 && !persCols2.some((c) => c.name === 'device_id')) {
    sqlite.exec("ALTER TABLE personnel ADD COLUMN device_id TEXT DEFAULT ''");
  }

  // Add notes column to planned_templates if missing.
  const ptCols = sqlite.pragma('table_info(planned_templates)') as { name: string }[];
  if (ptCols.length > 0 && !ptCols.some((c) => c.name === 'notes')) {
    const isCrrView = !!(sqlite.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'view' AND name = 'planned_templates'",
    ).get());
    if (isCrrView) {
      sqlite.exec('ALTER TABLE planned_templates__crsql_crr ADD COLUMN notes TEXT');
    } else {
      sqlite.exec('ALTER TABLE planned_templates ADD COLUMN notes TEXT');
    }
  }

  // After adding notes column to planned_templates, CRR triggers become stale
  // (they reference the old column set, causing "expected N values, got M" errors).
  // Drop stale triggers and re-register the CRR to rebuild them. Guarded by sentinel.
  if (isCrrInitialized(sqlite)) {
    const ptCrrSentinel = sqlite.prepare("SELECT value FROM sync_meta WHERE key = '_crr_planned_notes_v2'").get() as
      | { value: string }
      | undefined;
    if (!ptCrrSentinel) {
      // Must drop triggers first — crsql_as_crr skips re-creation if they exist
      sqlite.exec('DROP TRIGGER IF EXISTS "planned_templates__crsql_itrig"');
      sqlite.exec('DROP TRIGGER IF EXISTS "planned_templates__crsql_utrig"');
      sqlite.exec('DROP TRIGGER IF EXISTS "planned_templates__crsql_dtrig"');
      sqlite.exec("SELECT crsql_as_crr('planned_templates')");
      sqlite.prepare(
        "INSERT INTO sync_meta (key, value) VALUES ('_crr_planned_notes_v2', '1') ON CONFLICT(key) DO UPDATE SET value = '1'",
      ).run();
    }
  }

  // Add linked_id column to transactions if missing (inter-account transfers)
  const txCols2 = sqlite.pragma('table_info(transactions)') as { name: string }[];
  const txIsCrrView = !!(sqlite.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'view' AND name = 'transactions'",
  ).get());
  if (txCols2.length > 0 && !txCols2.some((c) => c.name === 'linked_id')) {
    if (txIsCrrView) {
      sqlite.exec('ALTER TABLE transactions__crsql_crr ADD COLUMN linked_id TEXT');
    } else {
      sqlite.exec('ALTER TABLE transactions ADD COLUMN linked_id TEXT');
    }
  }
  // Index must be created after migration ensures the column exists (not in SCHEMA_DDL,
  // which runs before migrations on existing databases that lack the column).
  // For CRR databases, the index goes on the underlying table, not the view.
  if (txIsCrrView) {
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_transactions_linked ON transactions__crsql_crr(linked_id)');
  } else {
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_transactions_linked ON transactions(linked_id)');
  }

  // Add transfer_target_sheet column to planned_templates if missing (transfer templates)
  const ptCols2 = sqlite.pragma('table_info(planned_templates)') as { name: string }[];
  if (ptCols2.length > 0 && !ptCols2.some((c) => c.name === 'transfer_target_sheet')) {
    const isCrrView = !!(sqlite.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'view' AND name = 'planned_templates'",
    ).get());
    if (isCrrView) {
      sqlite.exec('ALTER TABLE planned_templates__crsql_crr ADD COLUMN transfer_target_sheet TEXT');
    } else {
      sqlite.exec('ALTER TABLE planned_templates ADD COLUMN transfer_target_sheet TEXT');
    }
  }

  // After adding linked_id/transfer_target_sheet, CRR triggers become stale.
  // Drop and re-register to rebuild them.
  if (isCrrInitialized(sqlite)) {
    const txCrrSentinel = sqlite.prepare("SELECT value FROM sync_meta WHERE key = '_crr_tx_linked_id'").get() as
      | { value: string }
      | undefined;
    if (!txCrrSentinel) {
      sqlite.exec('DROP TRIGGER IF EXISTS "transactions__crsql_itrig"');
      sqlite.exec('DROP TRIGGER IF EXISTS "transactions__crsql_utrig"');
      sqlite.exec('DROP TRIGGER IF EXISTS "transactions__crsql_dtrig"');
      sqlite.exec("SELECT crsql_as_crr('transactions')");
      sqlite.prepare(
        "INSERT INTO sync_meta (key, value) VALUES ('_crr_tx_linked_id', '1') ON CONFLICT(key) DO UPDATE SET value = '1'",
      ).run();
    }

    const ptCrrSentinel2 = sqlite.prepare("SELECT value FROM sync_meta WHERE key = '_crr_planned_transfer_sheet'").get() as
      | { value: string }
      | undefined;
    if (!ptCrrSentinel2) {
      sqlite.exec('DROP TRIGGER IF EXISTS "planned_templates__crsql_itrig"');
      sqlite.exec('DROP TRIGGER IF EXISTS "planned_templates__crsql_utrig"');
      sqlite.exec('DROP TRIGGER IF EXISTS "planned_templates__crsql_dtrig"');
      sqlite.exec("SELECT crsql_as_crr('planned_templates')");
      sqlite.prepare(
        "INSERT INTO sync_meta (key, value) VALUES ('_crr_planned_transfer_sheet', '1') ON CONFLICT(key) DO UPDATE SET value = '1'",
      ).run();
    }
  }

  // Migrate sync watermarks from CRR settings table to non-CRR sync_meta table.
  // Writing watermarks to a CRR table bumps db_version, causing an infinite export loop.
  migrateSyncWatermarks(sqlite);
}

/** Move sync watermark keys from settings (CRR) to sync_meta (non-CRR). */
function migrateSyncWatermarks(sqlite: Database.Database): void {
  const syncKeys = ['sync.lastExportedVersion', 'sync.sequenceNumber'];
  for (const key of syncKeys) {
    const row = sqlite.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    if (row) {
      sqlite
        .prepare(
          'INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        )
        .run(key, row.value);
      sqlite.prepare('DELETE FROM settings WHERE key = ?').run(key);
    }
  }
}

/**
 * Copy rows from a table into its freshly-created replacement, using the columns the
 * two have in common. Columns present only on the replacement fall back to their
 * DEFAULT; columns present only on the original are dropped.
 *
 * Deriving the list from the live schema rather than hardcoding it is the point:
 * a rebuild that predates a later ALTER TABLE would otherwise silently drop the
 * added column's data (`linked_id` and `transfer_target_sheet` were both missing
 * from the hardcoded lists this replaced).
 */
function copyCommonColumns(sqlite: Database.Database, from: string, to: string): void {
  const columnsOf = (table: string): string[] =>
    (sqlite.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
  const target = new Set(columnsOf(to));
  const shared = columnsOf(from)
    .filter((name) => target.has(name))
    .map((name) => `"${name}"`)
    .join(', ');
  sqlite.exec(`INSERT INTO ${to} (${shared}) SELECT ${shared} FROM ${from}`);
}

/** Rebuild synced tables to add DEFAULT on all NOT NULL columns (CRR requirement). */
function migrateCrrDefaults(sqlite: Database.Database): void {
  const crrActive = isCrrInitialized(sqlite);
  const rebuiltTables: string[] = [];

  // Load extension before any table rebuilds if CRRs are active —
  // DROP TABLE will fire CRR cleanup triggers that need the extension.
  if (crrActive) {
    sqlite.loadExtension(extensionPath);
  }

  // Helper to check if a table exists and needs migration (has NOT NULL cols without DEFAULT)
  const needsMigration = (table: string): boolean => {
    const cols = sqlite.pragma(`table_info(${table})`) as {
      name: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }[];
    // If table doesn't exist yet (new db), skip
    if (cols.length === 0) return false;
    return cols.some((c) => c.notnull === 1 && c.dflt_value === null && c.pk === 0);
  };

  // Each entry: [table, CREATE DDL for _new, indexes to recreate].
  // Columns to copy are derived from the live schema — see copyCommonColumns.
  const migrations: {
    table: string;
    createNew: string;
    indexes: string[];
  }[] = [
    {
      table: 'transactions',
      createNew: `CREATE TABLE transactions_new (
        id TEXT PRIMARY KEY NOT NULL DEFAULT '',
        date TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        amount TEXT NOT NULL DEFAULT '0',
        type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('income', 'expense')),
        status TEXT NOT NULL DEFAULT '--' CHECK (status IN ('--', 'pending', 'approved', 'rejected', 'planned')),
        sheet TEXT NOT NULL DEFAULT '',
        category TEXT, party TEXT, reference TEXT, activity TEXT, notes TEXT,
        linked_id TEXT,
        version INTEGER DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT '',
        modified_at TEXT, modified_by TEXT
      )`,
      indexes: [
        'CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date)',
        'CREATE INDEX IF NOT EXISTS idx_transactions_sheet ON transactions(sheet)',
        'CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type)',
        'CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status)',
        'CREATE INDEX IF NOT EXISTS idx_transactions_linked ON transactions(linked_id)',
      ],
    },
    {
      table: 'planned_templates',
      createNew: `CREATE TABLE planned_templates_new (
        id TEXT PRIMARY KEY NOT NULL DEFAULT '',
        start_date TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        amount TEXT NOT NULL DEFAULT '0',
        type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('income', 'expense')),
        frequency TEXT NOT NULL DEFAULT 'once' CHECK (frequency IN ('once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
        target_sheet TEXT NOT NULL DEFAULT '',
        category TEXT, party TEXT, activity TEXT, notes TEXT, transfer_target_sheet TEXT,
        end_date TEXT, occurrence_count INTEGER,
        skipped_dates TEXT DEFAULT '[]', fulfilled_dates TEXT DEFAULT '[]',
        version INTEGER DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT ''
      )`,
      indexes: [
        'CREATE INDEX IF NOT EXISTS idx_planned_start ON planned_templates(start_date)',
        'CREATE INDEX IF NOT EXISTS idx_planned_target ON planned_templates(target_sheet)',
      ],
    },
    {
      table: 'sheets',
      createNew: `CREATE TABLE sheets_new (
        id TEXT PRIMARY KEY NOT NULL DEFAULT '',
        name TEXT NOT NULL DEFAULT '',
        is_virtual INTEGER DEFAULT 0, is_planned INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT ''
      )`,
      indexes: ['CREATE INDEX IF NOT EXISTS idx_sheets_name ON sheets(name)'],
    },
    {
      table: 'attachments',
      createNew: `CREATE TABLE attachments_new (
        id TEXT PRIMARY KEY NOT NULL DEFAULT '',
        transaction_id TEXT NOT NULL DEFAULT '',
        filename TEXT NOT NULL DEFAULT '',
        stored_name TEXT NOT NULL DEFAULT '',
        mime_type TEXT, file_size INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT ''
      )`,
      indexes: ['CREATE INDEX IF NOT EXISTS idx_attachments_transaction ON attachments(transaction_id)'],
    },
    {
      table: 'audit_log',
      createNew: `CREATE TABLE audit_log_new (
        id TEXT PRIMARY KEY NOT NULL DEFAULT '',
        timestamp TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL DEFAULT 'create' CHECK (action IN ('create', 'update', 'delete')),
        entity_type TEXT NOT NULL DEFAULT '',
        entity_id TEXT NOT NULL DEFAULT '',
        user TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        details TEXT
      )`,
      indexes: [
        'CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp)',
        'CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id)',
      ],
    },
    {
      table: 'activity_notes',
      createNew: `CREATE TABLE activity_notes_new (
        activity TEXT PRIMARY KEY NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT ''
      )`,
      indexes: [],
    },
    {
      table: 'invoices',
      createNew: `CREATE TABLE invoices_new (
        id TEXT PRIMARY KEY NOT NULL DEFAULT '',
        invoice_number TEXT NOT NULL DEFAULT '',
        date TEXT NOT NULL DEFAULT '',
        due_date TEXT NOT NULL DEFAULT '',
        from_name TEXT NOT NULL DEFAULT '',
        from_address TEXT,
        to_name TEXT NOT NULL DEFAULT '',
        to_address TEXT,
        line_items TEXT NOT NULL DEFAULT '[]',
        subtotal TEXT NOT NULL DEFAULT '0',
        notes TEXT, bank_details TEXT, planned_template_id TEXT,
        status TEXT DEFAULT 'draft',
        transaction_id TEXT, paid_at TEXT, planned_template_snapshot TEXT,
        version INTEGER DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT '',
        modified_at TEXT, modified_by TEXT
      )`,
      indexes: [
        'CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date)',
        'CREATE INDEX IF NOT EXISTS idx_invoices_planned ON invoices(planned_template_id)',
      ],
    },
  ];

  for (const m of migrations) {
    if (!needsMigration(m.table)) continue;
    sqlite.exec(m.createNew);
    copyCommonColumns(sqlite, m.table, `${m.table}_new`);
    sqlite.exec(`DROP TABLE ${m.table}`);
    sqlite.exec(`ALTER TABLE ${m.table}_new RENAME TO ${m.table}`);
    for (const idx of m.indexes) {
      sqlite.exec(idx);
    }
    rebuiltTables.push(m.table);
  }

  // Re-register rebuilt tables as CRRs (table rebuild destroys CRR triggers)
  if (crrActive) {
    for (const table of rebuiltTables) {
      sqlite.exec(`SELECT crsql_as_crr('${table}')`);
    }
  }
}

/**
 * Rebuild settings and personnel tables so their PKs are NOT NULL with a DEFAULT.
 * These were missed in migrateCrrDefaults (settings was added later via scope migration,
 * personnel was added for Local Sync). cr-sqlite requires non-nullable PKs with defaults.
 */
function migrateCrrPrimaryKeys(sqlite: Database.Database): void {
  const crrActive = isCrrInitialized(sqlite);
  const rebuiltTables: string[] = [];

  // Load extension before any table rebuilds if CRRs are active —
  // DROP TABLE will fire CRR cleanup triggers that need the extension.
  if (crrActive) {
    sqlite.loadExtension(extensionPath);
  }

  // Helper: check if PK column has NOT NULL + DEFAULT
  const pkNeedsFix = (table: string, pkCol: string): boolean => {
    const cols = sqlite.pragma(`table_info(${table})`) as {
      name: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }[];
    if (cols.length === 0) return false;
    const pk = cols.find((c) => c.name === pkCol);
    if (!pk) return false;
    // Needs fix if missing NOT NULL or missing DEFAULT
    return pk.notnull === 0 || pk.dflt_value === null;
  };

  // settings: key TEXT PRIMARY KEY → key TEXT PRIMARY KEY NOT NULL DEFAULT ''
  if (pkNeedsFix('settings', 'key')) {
    sqlite.exec(`CREATE TABLE settings_tmp (
      key TEXT PRIMARY KEY NOT NULL DEFAULT '',
      value TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT 'device'
    )`);
    // `scope` may not exist yet on the old table; copyCommonColumns then leaves the
    // new column at its DEFAULT ('device').
    copyCommonColumns(sqlite, 'settings', 'settings_tmp');
    sqlite.exec('DROP TABLE settings');
    sqlite.exec('ALTER TABLE settings_tmp RENAME TO settings');
    rebuiltTables.push('settings');
  }

  // personnel: id TEXT PRIMARY KEY → id TEXT PRIMARY KEY NOT NULL DEFAULT ''
  if (pkNeedsFix('personnel', 'id')) {
    sqlite.exec(`CREATE TABLE personnel_tmp (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
      auth_uid TEXT,
      created_at TEXT NOT NULL DEFAULT '',
      invited_by TEXT,
      password_hash TEXT,
      encrypted_passphrase TEXT,
      passphrase_salt TEXT,
      device_id TEXT DEFAULT ''
    )`);
    // The auth and device columns may or may not be present yet, depending on how
    // far this database got before it was last opened.
    copyCommonColumns(sqlite, 'personnel', 'personnel_tmp');
    sqlite.exec('DROP TABLE personnel');
    sqlite.exec('ALTER TABLE personnel_tmp RENAME TO personnel');
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_personnel_email ON personnel(email)');
    rebuiltTables.push('personnel');
  }

  // Re-register rebuilt tables as CRRs (table rebuild destroys CRR triggers)
  if (crrActive) {
    for (const table of rebuiltTables) {
      sqlite.exec(`SELECT crsql_as_crr('${table}')`);
    }
  }
}

/**
 * Drop UNIQUE constraints that are incompatible with cr-sqlite CRRs.
 * Affected: sheets.name (UNIQUE column), categories(type,name) (composite UNIQUE),
 * personnel.email (UNIQUE INDEX).
 *
 * If CRRs were previously initialized, the extension must be loaded before
 * rebuilding tables (CRR triggers reference extension functions), and the
 * rebuilt tables must be re-registered as CRRs afterward.
 */
function migrateCrrUniqueConstraints(sqlite: Database.Database): void {
  const crrActive = isCrrInitialized(sqlite);

  // Load extension before any table rebuilds if CRRs are active —
  // DROP TABLE will fire CRR cleanup triggers that need the extension.
  if (crrActive) {
    sqlite.loadExtension(extensionPath);
  }

  // Helper: check if a table has a UNIQUE index besides the primary key
  const hasUniqueIndex = (table: string): boolean => {
    const indexes = sqlite.prepare(`PRAGMA index_list('${table}')`).all() as {
      name: string;
      unique: number;
      origin: string;
    }[];
    // origin 'pk' is the primary key, we only care about non-pk unique indexes
    return indexes.some((idx) => idx.unique === 1 && idx.origin !== 'pk');
  };

  const rebuiltTables: string[] = [];

  // 1. sheets: drop UNIQUE from name column
  if (hasUniqueIndex('sheets')) {
    sqlite.exec(`CREATE TABLE sheets_tmp (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      is_virtual INTEGER DEFAULT 0, is_planned INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT ''
    )`);
    copyCommonColumns(sqlite, 'sheets', 'sheets_tmp');
    sqlite.exec('DROP TABLE sheets');
    sqlite.exec('ALTER TABLE sheets_tmp RENAME TO sheets');
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_sheets_name ON sheets(name)');
    rebuiltTables.push('sheets');
  }

  // 2. categories: drop UNIQUE(type, name)
  if (hasUniqueIndex('categories')) {
    sqlite.exec(`CREATE TABLE categories_tmp (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('income', 'expense')),
      name TEXT NOT NULL DEFAULT '',
      sort_order INTEGER DEFAULT 0
    )`);
    copyCommonColumns(sqlite, 'categories', 'categories_tmp');
    sqlite.exec('DROP TABLE categories');
    sqlite.exec('ALTER TABLE categories_tmp RENAME TO categories');
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_categories_type ON categories(type)');
    rebuiltTables.push('categories');
  }

  // 3. personnel: drop UNIQUE index on email
  if (hasUniqueIndex('personnel')) {
    sqlite.exec('DROP INDEX IF EXISTS idx_personnel_email');
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_personnel_email ON personnel(email)');
  }

  // Re-register rebuilt tables as CRRs (table rebuild destroys CRR triggers)
  if (crrActive) {
    for (const table of rebuiltTables) {
      sqlite.exec(`SELECT crsql_as_crr('${table}')`);
    }
  }
}

export interface OpenDatabaseResult {
  db: Database.Database;
  databaseId: string;
}

export function openDatabase(dbPath: string): OpenDatabaseResult {
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  // Always load cr-sqlite extension. CRR triggers (if any) reference extension
  // functions like crsql_internal_sync_bit — they must be available on every
  // connection, even for Cloud Connect windows. Lightweight: just registers
  // functions with this connection, no schema changes.
  sqlite.loadExtension(extensionPath);
  sqlite.exec(SCHEMA_DDL);
  runMigrations(sqlite);

  const databaseId = getOrCreateDatabaseId(sqlite);
  migrateAttachmentsIfNeeded(dbPath, databaseId);

  return { db: sqlite, databaseId };
}

/**
 * Read or create a stable per-database UUID stored in sync_meta.
 * Every database (standalone or Local Sync) gets one on first open.
 */
function getOrCreateDatabaseId(sqlite: Database.Database): string {
  const row = sqlite.prepare("SELECT value FROM sync_meta WHERE key = 'database.id'").get() as
    | { value: string }
    | undefined;
  if (row?.value) return row.value;

  const id = crypto.randomUUID();
  sqlite
    .prepare(
      "INSERT INTO sync_meta (key, value) VALUES ('database.id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(id);
  return id;
}

/**
 * One-time migration: move legacy sibling `fidra_attachments/` folder
 * to the stable `~/.fidra/attachments/<databaseId>/` location.
 */
function migrateAttachmentsIfNeeded(dbPath: string, databaseId: string): void {
  const legacyDir = path.join(path.dirname(dbPath), 'fidra_attachments');
  if (!fs.existsSync(legacyDir)) return;

  const newDir = path.join(os.homedir(), '.fidra', 'attachments', databaseId);
  fs.mkdirSync(newDir, { recursive: true });
  // Copy legacy contents into new location (cpSync merges into existing dir)
  fs.cpSync(legacyDir, newDir, { recursive: true, force: false });

  // Remove legacy folder after successful copy
  try {
    fs.rmSync(legacyDir, { recursive: true, force: true });
    console.log(`[DB] Migrated attachments from ${legacyDir} to ${newDir}`);
  } catch (e) {
    console.warn('[DB] Failed to remove legacy attachment folder:', e);
  }
}

/** Resolve the attachment storage directory for a given database ID. */
export function getAttachmentStoragePath(databaseId: string): string {
  return path.join(os.homedir(), '.fidra', 'attachments', databaseId);
}
