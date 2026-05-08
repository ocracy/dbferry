import { nanoid } from 'nanoid'
import type { Project, TableConfig, DbConfig } from '@shared/types'
import { getDb } from './sqlite'

interface ProjectRow {
  id: string
  name: string
  source_config: string
  target_config: string
  schedule_cron: string | null
  schedule_enabled: number
  table_concurrency: number
  created_at: number
  updated_at: number
}

interface TableConfigRow {
  project_id: string
  table_name: string
  mode: string
  pk_column: string
}

function rowToProject(row: ProjectRow, tables: TableConfig[]): Project {
  return {
    id: row.id,
    name: row.name,
    source: JSON.parse(row.source_config) as DbConfig,
    target: JSON.parse(row.target_config) as DbConfig,
    tables,
    scheduleEnabled: row.schedule_enabled === 1,
    scheduleCron: row.schedule_cron,
    tableConcurrency: row.table_concurrency,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function loadTables(projectId: string): TableConfig[] {
  const db = getDb()
  const rows = db
    .prepare<[string], TableConfigRow>(
      'SELECT project_id, table_name, mode, pk_column FROM table_configs WHERE project_id = ? ORDER BY table_name'
    )
    .all(projectId)
  return rows.map((r) => ({
    name: r.table_name,
    mode: r.mode as TableConfig['mode'],
    pkColumn: r.pk_column
  }))
}

export const projectsRepo = {
  list(): Project[] {
    const db = getDb()
    const rows = db
      .prepare<[], ProjectRow>('SELECT * FROM projects ORDER BY updated_at DESC')
      .all()
    return rows.map((r) => rowToProject(r, loadTables(r.id)))
  },

  get(id: string): Project | null {
    const db = getDb()
    const row = db
      .prepare<[string], ProjectRow>('SELECT * FROM projects WHERE id = ?')
      .get(id)
    if (!row) return null
    return rowToProject(row, loadTables(id))
  },

  create(input: {
    name: string
    source: DbConfig
    target: DbConfig
    tables?: TableConfig[]
    scheduleEnabled?: boolean
    scheduleCron?: string | null
    tableConcurrency?: number
  }): Project {
    const db = getDb()
    const id = nanoid(12)
    const now = Date.now()
    db.prepare(
      `INSERT INTO projects (id, name, source_config, target_config, schedule_cron, schedule_enabled, table_concurrency, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.name,
      JSON.stringify(input.source),
      JSON.stringify(input.target),
      input.scheduleCron ?? null,
      input.scheduleEnabled ? 1 : 0,
      input.tableConcurrency ?? 3,
      now,
      now
    )
    if (input.tables?.length) projectsRepo.replaceTables(id, input.tables)
    return projectsRepo.get(id)!
  },

  update(id: string, patch: Partial<Omit<Project, 'id' | 'createdAt' | 'tables'>>): Project | null {
    const db = getDb()
    const existing = projectsRepo.get(id)
    if (!existing) return null
    const merged = { ...existing, ...patch, updatedAt: Date.now() }
    db.prepare(
      `UPDATE projects SET name = ?, source_config = ?, target_config = ?, schedule_cron = ?, schedule_enabled = ?, table_concurrency = ?, updated_at = ? WHERE id = ?`
    ).run(
      merged.name,
      JSON.stringify(merged.source),
      JSON.stringify(merged.target),
      merged.scheduleCron,
      merged.scheduleEnabled ? 1 : 0,
      merged.tableConcurrency,
      merged.updatedAt,
      id
    )
    return projectsRepo.get(id)
  },

  delete(id: string): void {
    const db = getDb()
    db.prepare('DELETE FROM projects WHERE id = ?').run(id)
  },

  replaceTables(projectId: string, tables: TableConfig[]): void {
    const db = getDb()
    const tx = db.transaction((rows: TableConfig[]) => {
      db.prepare('DELETE FROM table_configs WHERE project_id = ?').run(projectId)
      const ins = db.prepare(
        'INSERT INTO table_configs (project_id, table_name, mode, pk_column) VALUES (?, ?, ?, ?)'
      )
      for (const t of rows) ins.run(projectId, t.name, t.mode, t.pkColumn || 'id')
      db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(Date.now(), projectId)
    })
    tx(tables)
  },

  upsertTable(projectId: string, table: TableConfig): void {
    const db = getDb()
    db.prepare(
      `INSERT INTO table_configs (project_id, table_name, mode, pk_column)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(project_id, table_name) DO UPDATE SET mode = excluded.mode, pk_column = excluded.pk_column`
    ).run(projectId, table.name, table.mode, table.pkColumn || 'id')
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(Date.now(), projectId)
  }
}
