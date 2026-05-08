import type Database from 'better-sqlite3'

const MIGRATIONS: Array<{ id: number; sql: string }> = [
  {
    id: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        source_config TEXT NOT NULL,
        target_config TEXT NOT NULL,
        schedule_cron TEXT,
        schedule_enabled INTEGER NOT NULL DEFAULT 0,
        table_concurrency INTEGER NOT NULL DEFAULT 3,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS table_configs (
        project_id TEXT NOT NULL,
        table_name TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'disabled',
        pk_column TEXT NOT NULL DEFAULT 'id',
        PRIMARY KEY (project_id, table_name),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS sync_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        status TEXT NOT NULL,
        trigger TEXT NOT NULL,
        full_count INTEGER NOT NULL DEFAULT 0,
        incremental_count INTEGER NOT NULL DEFAULT 0,
        disabled_count INTEGER NOT NULL DEFAULT 0,
        error_summary TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_sync_runs_project_started
        ON sync_runs(project_id, started_at DESC);

      CREATE TABLE IF NOT EXISTS sync_table_runs (
        run_id TEXT NOT NULL,
        table_name TEXT NOT NULL,
        mode TEXT NOT NULL,
        rows_copied INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        error TEXT,
        PRIMARY KEY (run_id, table_name),
        FOREIGN KEY (run_id) REFERENCES sync_runs(id) ON DELETE CASCADE
      );
    `
  },
  {
    id: 2,
    sql: `
      ALTER TABLE sync_runs ADD COLUMN total_rows INTEGER NOT NULL DEFAULT 0;
    `
  }
]

export function runMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);`)
  const applied = new Set(
    db.prepare<[], { id: number }>('SELECT id FROM _migrations').all().map((r) => r.id)
  )
  const insertMig = db.prepare('INSERT INTO _migrations (id, applied_at) VALUES (?, ?)')
  const tx = db.transaction((m: { id: number; sql: string }) => {
    db.exec(m.sql)
    insertMig.run(m.id, Date.now())
  })
  for (const m of MIGRATIONS) {
    if (!applied.has(m.id)) tx(m)
  }
}
