import { ipcMain } from 'electron'
import type { ConnectionTestResult, DbConfig } from '@shared/types'
import { MysqlAdapter } from '../sync-engine/adapters/mysql'
import { PostgresAdapter } from '../sync-engine/adapters/postgres'
import { secrets } from '../secrets/keytar'
import { projectsRepo } from '../storage/projects.repo'

function build(cfg: DbConfig, password: string) {
  return cfg.type === 'mysql'
    ? new MysqlAdapter({ config: cfg, password })
    : new PostgresAdapter({ config: cfg, password })
}

async function testConnection(cfg: DbConfig, password: string): Promise<ConnectionTestResult> {
  const adapter = build(cfg, password)
  try {
    await adapter.connect()
    const { serverVersion } = await adapter.ping()
    let tableCount: number | undefined
    try {
      const tables = await adapter.listTables()
      tableCount = tables.length
    } catch {}
    return { ok: true, message: 'Connected', serverVersion, tableCount }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  } finally {
    try {
      await adapter.close()
    } catch {}
  }
}

async function listDatabases(cfg: DbConfig, password: string): Promise<string[]> {
  if (cfg.type === 'mysql') {
    const mysql = await import('mysql2/promise')
    const conn = await mysql.createConnection({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password,
      ssl: cfg.ssl ? {} : undefined
    })
    try {
      const [rows] = await conn.query<any[]>('SHOW DATABASES')
      const skip = new Set(['information_schema', 'performance_schema', 'mysql', 'sys'])
      return rows
        .map((r: any) => String(r.Database ?? Object.values(r)[0]))
        .filter((n) => !skip.has(n))
        .sort()
    } finally {
      await conn.end()
    }
  } else {
    const { Client } = await import('pg')
    const client = new Client({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password,
      database: cfg.database || 'postgres',
      ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined
    })
    await client.connect()
    try {
      const r = await client.query<{ datname: string }>(
        `SELECT datname FROM pg_database
          WHERE datistemplate = false
          ORDER BY datname`
      )
      return r.rows.map((row) => row.datname)
    } finally {
      await client.end()
    }
  }
}

export function registerConnectionIpc(): void {
  ipcMain.handle(
    'connection:test',
    async (_e, payload: { config: DbConfig; password: string }) =>
      testConnection(payload.config, payload.password)
  )

  ipcMain.handle(
    'connection:listDatabases',
    async (_e, payload: { config: DbConfig; password: string }) =>
      listDatabases(payload.config, payload.password)
  )

  ipcMain.handle(
    'connection:testStored',
    async (_e, payload: { projectId: string; side: 'source' | 'target' }) => {
      const project = projectsRepo.get(payload.projectId)
      if (!project) return { ok: false, message: 'Project not found' } satisfies ConnectionTestResult
      const password = await secrets.getPassword(payload.projectId, payload.side)
      if (password === null) return { ok: false, message: 'Password not set' } satisfies ConnectionTestResult
      const cfg = payload.side === 'source' ? project.source : project.target
      return testConnection(cfg, password)
    }
  )

  ipcMain.handle(
    'connection:listTables',
    async (_e, payload: { projectId: string; side: 'source' | 'target' }) => {
      const project = projectsRepo.get(payload.projectId)
      if (!project) throw new Error('Project not found')
      const password = await secrets.getPassword(payload.projectId, payload.side)
      if (password === null) throw new Error('Password not set')
      const cfg = payload.side === 'source' ? project.source : project.target
      const adapter = build(cfg, password)
      try {
        await adapter.connect()
        const tables = await adapter.listTables()
        return tables
      } finally {
        try {
          await adapter.close()
        } catch {}
      }
    }
  )

  ipcMain.handle(
    'connection:listTablesMeta',
    async (_e, payload: { projectId: string; side: 'source' | 'target' }) => {
      const project = projectsRepo.get(payload.projectId)
      if (!project) throw new Error('Project not found')
      const password = await secrets.getPassword(payload.projectId, payload.side)
      if (password === null) throw new Error('Password not set')
      const cfg = payload.side === 'source' ? project.source : project.target
      const adapter = build(cfg, password)
      try {
        await adapter.connect()
        return await adapter.listTablesMeta()
      } finally {
        try {
          await adapter.close()
        } catch {}
      }
    }
  )

  ipcMain.handle(
    'connection:getMaxPk',
    async (
      _e,
      payload: { projectId: string; side: 'source' | 'target'; table: string; pkColumn: string }
    ) => {
      const project = projectsRepo.get(payload.projectId)
      if (!project) throw new Error('Project not found')
      const password = await secrets.getPassword(payload.projectId, payload.side)
      if (password === null) throw new Error('Password not set')
      const cfg = payload.side === 'source' ? project.source : project.target
      const adapter = build(cfg, password)
      try {
        await adapter.connect()
        const v = await adapter.getMaxPk(payload.table, payload.pkColumn)
        return v == null ? null : String(v)
      } finally {
        try {
          await adapter.close()
        } catch {}
      }
    }
  )
}
