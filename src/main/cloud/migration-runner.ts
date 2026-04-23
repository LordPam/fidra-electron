import type pg from 'pg';

const CURRENT_SCHEMA_VERSION = 13;

const TABLES_SQL = `
-- Metadata table for schema versioning
CREATE TABLE IF NOT EXISTS fidra_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Transactions
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY,
  date DATE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  status TEXT NOT NULL CHECK (status IN ('--', 'pending', 'approved', 'rejected', 'planned')),
  sheet TEXT NOT NULL,
  category TEXT,
  party TEXT,
  reference TEXT,
  activity TEXT,
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  modified_at TIMESTAMPTZ,
  modified_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_sheet ON transactions(sheet);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_modified ON transactions(modified_at);

-- Planned Templates
CREATE TABLE IF NOT EXISTS planned_templates (
  id UUID PRIMARY KEY,
  start_date DATE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  frequency TEXT NOT NULL CHECK (frequency IN ('once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
  target_sheet TEXT NOT NULL,
  category TEXT,
  party TEXT,
  activity TEXT,
  end_date DATE,
  occurrence_count INTEGER,
  skipped_dates JSONB DEFAULT '[]',
  fulfilled_dates JSONB DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_planned_start ON planned_templates(start_date);
CREATE INDEX IF NOT EXISTS idx_planned_target ON planned_templates(target_sheet);

-- Sheets
CREATE TABLE IF NOT EXISTS sheets (
  id UUID PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  is_virtual BOOLEAN DEFAULT FALSE,
  is_planned BOOLEAN DEFAULT FALSE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sheets_name ON sheets(name);

-- Categories
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  UNIQUE(type, name)
);

CREATE INDEX IF NOT EXISTS idx_categories_type ON categories(type);

-- Attachments
CREATE TABLE IF NOT EXISTS attachments (
  id UUID PRIMARY KEY,
  transaction_id UUID NOT NULL,
  filename TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT,
  file_size INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attachments_transaction ON attachments(transaction_id);

-- Audit Log
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  "user" TEXT NOT NULL,
  summary TEXT NOT NULL,
  details TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);

-- Activity Notes
CREATE TABLE IF NOT EXISTS activity_notes (
  activity TEXT PRIMARY KEY,
  notes TEXT NOT NULL
);

-- Invoices
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY,
  invoice_number TEXT NOT NULL,
  date DATE NOT NULL,
  due_date DATE NOT NULL,
  from_name TEXT NOT NULL,
  from_address TEXT,
  to_name TEXT NOT NULL,
  to_address TEXT,
  line_items JSONB NOT NULL,
  subtotal NUMERIC(12,2) NOT NULL,
  notes TEXT,
  bank_details TEXT,
  planned_template_id UUID,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'paid')),
  transaction_id UUID,
  paid_at TIMESTAMPTZ,
  planned_template_snapshot JSONB,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  modified_at TIMESTAMPTZ,
  modified_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date);
CREATE INDEX IF NOT EXISTS idx_invoices_planned ON invoices(planned_template_id);
`;

const NOTIFY_FUNCTION_SQL = `
CREATE OR REPLACE FUNCTION fidra_notify_change()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify(
        'fidra_changes',
        json_build_object(
            'table', TG_TABLE_NAME,
            'op', TG_OP
        )::text
    );
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
`;

const WATCHED_TABLES = [
  'transactions',
  'planned_templates',
  'sheets',
  'categories',
  'activity_notes',
  'attachments',
  'invoices',
  'audit_log',
];

function createTriggerSql(table: string): string {
  return `
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'fidra_notify_${table}'
    ) THEN
        CREATE TRIGGER fidra_notify_${table}
            AFTER INSERT OR UPDATE OR DELETE ON ${table}
            FOR EACH ROW EXECUTE FUNCTION fidra_notify_change();
    END IF;
END $$;
`;
}

export async function hasPersonnel(pool: pg.Pool): Promise<boolean> {
  try {
    const { rows } = await pool.query('SELECT 1 FROM personnel LIMIT 1');
    return rows.length > 0;
  } catch {
    return false; // Table might not exist yet
  }
}

export async function runMigrations(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    // Check if we need to run migrations
    await client.query('BEGIN');

    // Create metadata table first (outside the version check)
    await client.query(`
      CREATE TABLE IF NOT EXISTS fidra_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Check current schema version
    const versionRow = await client.query(
      "SELECT value FROM fidra_metadata WHERE key = 'schema_version'",
    );
    const currentVersion = versionRow.rows.length > 0
      ? parseInt(versionRow.rows[0].value, 10)
      : 0;

    if (currentVersion >= CURRENT_SCHEMA_VERSION) {
      await client.query('COMMIT');
      console.log(`Cloud schema up to date (version ${currentVersion})`);
      return;
    }

    console.log(`Migrating cloud schema from version ${currentVersion} to ${CURRENT_SCHEMA_VERSION}...`);

    // Run table creation (idempotent)
    await client.query(TABLES_SQL);

    // Create NOTIFY trigger function
    await client.query(NOTIFY_FUNCTION_SQL);

    // Create per-table triggers
    for (const table of WATCHED_TABLES) {
      await client.query(createTriggerSql(table));
    }

    // Detect Supabase auth schema — RLS policies use auth.uid()/auth.jwt() which
    // only exist on Supabase Postgres. Plain Postgres (Railway, Azure, self-hosted)
    // won't have these functions, so we skip RLS entirely. This is safe because
    // pg.Pool connections use the database owner role which bypasses RLS anyway.
    const { rows: authSchema } = await client.query(
      "SELECT 1 FROM pg_namespace WHERE nspname = 'auth' LIMIT 1",
    );
    const hasSupabaseAuth = authSchema.length > 0;

    // Version-specific migrations
    if (currentVersion < 3) {
      // Add sort_order column to sheets for reordering
      const colCheck = await client.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name = 'sheets' AND column_name = 'sort_order'`,
      );
      if (colCheck.rows.length === 0) {
        await client.query('ALTER TABLE sheets ADD COLUMN sort_order INTEGER DEFAULT 0');
      }
    }

    if (currentVersion < 4) {
      // Personnel table for auth & access control
      await client.query(`
        CREATE TABLE IF NOT EXISTS personnel (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          email TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
          auth_uid TEXT UNIQUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          invited_by UUID REFERENCES personnel(id)
        );
        CREATE INDEX IF NOT EXISTS idx_personnel_email ON personnel(email);
        CREATE INDEX IF NOT EXISTS idx_personnel_auth_uid ON personnel(auth_uid);
      `);

      // Create NOTIFY trigger for personnel table (must come after table creation)
      await client.query(createTriggerSql('personnel'));

      if (hasSupabaseAuth) {
        // Enable RLS on all data tables + personnel
        // RLS is only enforced on PostgREST (member mode) connections.
        // Admin mode uses the service-role key or direct pg connection which bypasses RLS.
        const rlsTables = [
          'transactions', 'planned_templates', 'sheets', 'categories',
          'activity_notes', 'attachments', 'audit_log', 'personnel',
        ];

        for (const table of rlsTables) {
          await client.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
        }

        // Data tables: authenticated personnel get full CRUD
        const dataTables = [
          'transactions', 'planned_templates', 'sheets', 'categories',
          'activity_notes', 'attachments', 'audit_log',
        ];
        for (const table of dataTables) {
          await client.query(`
            DO $$ BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM pg_policies WHERE tablename = '${table}' AND policyname = 'personnel_full_access'
              ) THEN
                CREATE POLICY personnel_full_access ON ${table}
                  FOR ALL
                  USING (
                    EXISTS (SELECT 1 FROM personnel WHERE auth_uid = auth.uid()::text)
                  )
                  WITH CHECK (
                    EXISTS (SELECT 1 FROM personnel WHERE auth_uid = auth.uid()::text)
                  );
              END IF;
            END $$;
          `);
        }

        // Personnel table RLS policies.
        await client.query(`
          CREATE OR REPLACE FUNCTION is_admin_user() RETURNS boolean
          LANGUAGE sql SECURITY DEFINER STABLE
          AS $$
            SELECT EXISTS (
              SELECT 1 FROM personnel WHERE auth_uid = auth.uid()::text AND role = 'admin'
            );
          $$;
        `);

        await client.query(`
          DO $$ BEGIN
            DROP POLICY IF EXISTS personnel_select ON personnel;
            DROP POLICY IF EXISTS personnel_self_select_by_email ON personnel;
            DROP POLICY IF EXISTS personnel_self_link ON personnel;
            DROP POLICY IF EXISTS personnel_admin_modify ON personnel;

            CREATE POLICY personnel_select ON personnel
              FOR SELECT
              USING (auth.role() = 'authenticated');

            CREATE POLICY personnel_self_link ON personnel
              FOR UPDATE
              USING (
                lower(email) = lower(auth.jwt() ->> 'email')
                AND (auth_uid IS NULL OR auth_uid = '')
              )
              WITH CHECK (
                lower(email) = lower(auth.jwt() ->> 'email')
              );

            CREATE POLICY personnel_admin_modify ON personnel
              FOR ALL
              USING (is_admin_user())
              WITH CHECK (is_admin_user());
          END $$;
        `);

        await client.query(`ALTER TABLE fidra_metadata ENABLE ROW LEVEL SECURITY`);
        await client.query(`
          DO $$ BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_policies WHERE tablename = 'fidra_metadata' AND policyname = 'metadata_personnel_access'
            ) THEN
              CREATE POLICY metadata_personnel_access ON fidra_metadata
                FOR ALL
                USING (
                  EXISTS (SELECT 1 FROM personnel WHERE auth_uid = auth.uid()::text)
                )
                WITH CHECK (
                  EXISTS (SELECT 1 FROM personnel WHERE auth_uid = auth.uid()::text)
                );
            END IF;
          END $$;
        `);
      } else {
        console.log('[MIGRATION] No auth schema found — skipping RLS policies (plain Postgres)');
      }
    }

    if (currentVersion < 6 && hasSupabaseAuth) {
      // Fix personnel RLS policies: the old policies used self-referencing
      // subqueries (EXISTS SELECT FROM personnel ...) which cause infinite
      // recursion (error 42P17) when accessed via PostgREST/member mode.
      // Replace with non-recursive policies + a SECURITY DEFINER helper function.

      await client.query(`
        CREATE OR REPLACE FUNCTION is_admin_user() RETURNS boolean
        LANGUAGE sql SECURITY DEFINER STABLE
        AS $$
          SELECT EXISTS (
            SELECT 1 FROM personnel WHERE auth_uid = auth.uid()::text AND role = 'admin'
          );
        $$;
      `);

      await client.query(`
        DO $$ BEGIN
          DROP POLICY IF EXISTS personnel_select ON personnel;
          DROP POLICY IF EXISTS personnel_self_select_by_email ON personnel;
          DROP POLICY IF EXISTS personnel_self_link ON personnel;
          DROP POLICY IF EXISTS personnel_admin_modify ON personnel;

          CREATE POLICY personnel_select ON personnel
            FOR SELECT
            USING (auth.role() = 'authenticated');

          CREATE POLICY personnel_self_link ON personnel
            FOR UPDATE
            USING (
              lower(email) = lower(auth.jwt() ->> 'email')
              AND (auth_uid IS NULL OR auth_uid = '')
            )
            WITH CHECK (
              lower(email) = lower(auth.jwt() ->> 'email')
            );

          CREATE POLICY personnel_admin_modify ON personnel
            FOR ALL
            USING (is_admin_user())
            WITH CHECK (is_admin_user());
        END $$;
      `);
    }

    if (currentVersion < 7) {
      // Invoices table is created by TABLES_SQL above (idempotent).
      // NOTIFY trigger is created by the WATCHED_TABLES loop above.
      if (hasSupabaseAuth) {
        // Enable RLS and create access policy.
        await client.query('ALTER TABLE invoices ENABLE ROW LEVEL SECURITY');
        await client.query(`
          DO $$ BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_policies WHERE tablename = 'invoices' AND policyname = 'personnel_full_access'
            ) THEN
              CREATE POLICY personnel_full_access ON invoices
                FOR ALL
                USING (
                  EXISTS (SELECT 1 FROM personnel WHERE auth_uid = auth.uid()::text)
                )
                WITH CHECK (
                  EXISTS (SELECT 1 FROM personnel WHERE auth_uid = auth.uid()::text)
                );
            END IF;
          END $$;
        `);
      }
    }

    if (currentVersion < 8) {
      // db_settings table for per-database configuration (e.g. FY start month)
      await client.query(`
        CREATE TABLE IF NOT EXISTS db_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          modified_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      // Create NOTIFY trigger for db_settings (must come after table creation)
      await client.query(createTriggerSql('db_settings'));

      if (hasSupabaseAuth) {
        await client.query('ALTER TABLE db_settings ENABLE ROW LEVEL SECURITY');
        await client.query(`
          DO $$ BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_policies WHERE tablename = 'db_settings' AND policyname = 'personnel_full_access'
            ) THEN
              CREATE POLICY personnel_full_access ON db_settings
                FOR ALL
                USING (
                  EXISTS (SELECT 1 FROM personnel WHERE auth_uid = auth.uid()::text)
                )
                WITH CHECK (
                  EXISTS (SELECT 1 FROM personnel WHERE auth_uid = auth.uid()::text)
                );
            END IF;
          END $$;
        `);
      }
    }

    if (currentVersion < 12 && hasSupabaseAuth) {
      // Drop any previous versions of the function (parameter type may have changed)
      await client.query(`DROP FUNCTION IF EXISTS delete_auth_user(UUID)`);
      await client.query(`DROP FUNCTION IF EXISTS delete_auth_user(TEXT)`);

      // Create delete_auth_user with TEXT parameter:
      // PostgREST sends all RPC arguments as varchar/text. Using UUID as the
      // parameter type causes "operator does not exist: character varying = uuid"
      // during function resolution. TEXT avoids this; we cast to UUID inside.
      await client.query(`
        CREATE FUNCTION delete_auth_user(target_uid TEXT DEFAULT NULL)
        RETURNS void
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = public
        AS $$
        BEGIN
          IF auth.uid() IS NOT NULL THEN
            IF NOT EXISTS (
              SELECT 1 FROM personnel
              WHERE auth_uid = auth.uid()::text AND role = 'admin'
            ) THEN
              RAISE EXCEPTION 'Only admins can delete auth users';
            END IF;
          END IF;

          UPDATE personnel SET invited_by = NULL WHERE invited_by = (
            SELECT id FROM personnel WHERE auth_uid = target_uid
          );

          -- Auth schema column types vary across Supabase versions (uuid vs varchar).
          -- Use text comparison throughout to avoid type mismatches.
          DELETE FROM auth.refresh_tokens WHERE user_id::text = target_uid;
          DELETE FROM auth.sessions WHERE user_id::text = target_uid;
          DELETE FROM auth.mfa_factors WHERE user_id::text = target_uid;
          DELETE FROM auth.identities WHERE user_id::text = target_uid;
          DELETE FROM auth.users WHERE id::text = target_uid;
        END;
        $$;
      `);

      await client.query(`GRANT EXECUTE ON FUNCTION delete_auth_user(TEXT) TO authenticated`);
      await client.query(`NOTIFY pgrst, 'reload schema'`);
    }

    if (currentVersion < 13) {
      // audit_log table already exists (created in TABLES_SQL).
      // Create NOTIFY trigger for audit_log so remote audit entries propagate.
      await client.query(createTriggerSql('audit_log'));
    }

    // Update schema version
    await client.query(
      `INSERT INTO fidra_metadata (key, value) VALUES ('schema_version', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [String(CURRENT_SCHEMA_VERSION)],
    );

    await client.query('COMMIT');
    console.log(`Cloud schema migration complete (version ${CURRENT_SCHEMA_VERSION})`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Cloud schema migration failed:', e instanceof Error ? e.message : String(e));
    throw e;
  } finally {
    client.release();
  }
}
