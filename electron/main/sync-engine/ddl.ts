import type { ColumnInfo, DbType } from '@shared/types'

/**
 * CREATE TABLE generation for tables that exist on the source but not on the target.
 *
 * This is deliberately conservative: it reproduces columns, nullability and the primary
 * key, and nothing else. Indexes, defaults, foreign keys, identity/auto-increment,
 * collations and check constraints are NOT carried over — the target is a sync
 * destination, and the engine writes explicit values for every column it copies.
 */

interface ParsedType {
  /** lowercased type name without arguments, e.g. `varchar` */
  base: string
  /** arguments inside the parentheses, e.g. [255] or [10, 2] */
  args: number[]
  /** raw lowercased type, e.g. `int unsigned` */
  raw: string
  unsigned: boolean
  isArray: boolean
}

function parseType(col: ColumnInfo): ParsedType {
  const raw = (col.fullType || col.dataType || '').trim().toLowerCase()
  const isArray = raw.endsWith('[]')
  const noArray = isArray ? raw.slice(0, -2) : raw
  const unsigned = /\bunsigned\b/.test(noArray)
  const m = noArray.match(/^([a-z0-9_ ]+?)\s*\(([^)]*)\)/)
  const base = (m ? m[1] : noArray.replace(/\s+unsigned\b/, '').replace(/\s+zerofill\b/, '')).trim()
  const args = m
    ? m[2]
        .split(',')
        .map((a) => Number(a.trim()))
        .filter((n) => Number.isFinite(n))
    : []
  return { base, args, raw: noArray, unsigned, isArray }
}

const MYSQL_TEXTISH = new Set(['tinytext', 'text', 'mediumtext', 'longtext'])
const MYSQL_BLOBISH = new Set(['tinyblob', 'blob', 'mediumblob', 'longblob'])

/** MySQL column type → PostgreSQL column type. */
function mysqlToPg(t: ParsedType): string {
  const { base, args, raw, unsigned } = t
  switch (base) {
    case 'tinyint':
      // TINYINT(1) is MySQL's boolean; coerceValue already maps the values.
      return args[0] === 1 ? 'boolean' : 'smallint'
    case 'bool':
    case 'boolean':
      return 'boolean'
    case 'smallint':
      return unsigned ? 'integer' : 'smallint'
    case 'mediumint':
      return 'integer'
    case 'int':
    case 'integer':
      return unsigned ? 'bigint' : 'integer'
    case 'bigint':
      // An unsigned bigint does not fit in PG's signed bigint.
      return unsigned ? 'numeric(20,0)' : 'bigint'
    case 'decimal':
    case 'numeric':
      return args.length === 2 ? `numeric(${args[0]},${args[1]})` : 'numeric'
    case 'float':
      return 'real'
    case 'double':
      return 'double precision'
    case 'bit':
      return args[0] === 1 ? 'boolean' : `bit(${args[0] ?? 1})`
    case 'char':
      return args[0] ? `char(${args[0]})` : 'char(1)'
    case 'varchar':
      return args[0] ? `varchar(${args[0]})` : 'text'
    case 'binary':
    case 'varbinary':
      return 'bytea'
    case 'json':
      return 'jsonb'
    case 'date':
      return 'date'
    case 'datetime':
    case 'timestamp':
      // Values are written as naive strings, so the target must be naive too.
      return 'timestamp'
    case 'time':
      return 'time'
    case 'year':
      return 'smallint'
    case 'enum':
    case 'set':
      return 'text'
    default:
      if (MYSQL_TEXTISH.has(base)) return 'text'
      if (MYSQL_BLOBISH.has(base)) return 'bytea'
      if (raw.includes('geometry') || raw.includes('point') || raw.includes('polygon')) return 'text'
      return 'text'
  }
}

/** PostgreSQL column type → MySQL column type. */
function pgToMysql(t: ParsedType): string {
  const { base, args, isArray } = t
  if (isArray) return 'json'
  switch (base) {
    case 'boolean':
    case 'bool':
      return 'tinyint(1)'
    case 'smallint':
    case 'int2':
      return 'smallint'
    case 'integer':
    case 'int':
    case 'int4':
    case 'serial':
      return 'int'
    case 'bigint':
    case 'int8':
    case 'bigserial':
      return 'bigint'
    case 'numeric':
    case 'decimal':
      if (args.length === 2) return `decimal(${Math.min(args[0], 65)},${Math.min(args[1], 30)})`
      return 'decimal(65,10)'
    case 'real':
    case 'float4':
      return 'float'
    case 'double precision':
    case 'float8':
      return 'double'
    case 'character varying':
    case 'varchar':
      // Long varchars do not fit in a MySQL row; fall back to text.
      return args[0] ? (args[0] <= 4096 ? `varchar(${args[0]})` : 'longtext') : 'longtext'
    case 'character':
    case 'char':
      return args[0] ? (args[0] <= 255 ? `char(${args[0]})` : `varchar(${args[0]})`) : 'char(1)'
    case 'text':
      return 'longtext'
    case 'json':
    case 'jsonb':
      return 'json'
    case 'uuid':
      return 'char(36)'
    case 'date':
      return 'date'
    case 'timestamp':
    case 'timestamp without time zone':
    case 'timestamp with time zone':
    case 'timestamptz':
      return 'datetime'
    case 'time':
    case 'time without time zone':
    case 'time with time zone':
      return 'time'
    case 'bytea':
      return 'longblob'
    case 'money':
      return 'decimal(19,4)'
    case 'inet':
    case 'cidr':
    case 'macaddr':
      return 'varchar(64)'
    case 'interval':
      return 'varchar(64)'
    case 'bit':
    case 'bit varying':
      return args[0] ? `varchar(${args[0]})` : 'varchar(64)'
    default:
      // Enums and other user-defined types arrive as their type name.
      return 'varchar(255)'
  }
}

/** The type to use on the target for a source column. */
export function mapColumnType(col: ColumnInfo, from: DbType, to: DbType): string {
  const t = parseType(col)
  if (!t.base) return to === 'mysql' ? 'longtext' : 'text'
  if (from === to) {
    // Same driver: keep the source definition verbatim.
    return col.fullType || col.dataType
  }
  return from === 'mysql' ? mysqlToPg(t) : pgToMysql(t)
}

/** MySQL cannot index a TEXT/BLOB column without a prefix length, so PKs get a bounded type. */
function pkSafeType(type: string, target: DbType): string {
  if (target !== 'mysql') return type
  const base = type.split('(')[0].trim().toLowerCase()
  if (MYSQL_TEXTISH.has(base) || MYSQL_BLOBISH.has(base)) return 'varchar(255)'
  return type
}

export interface CreateTableSql {
  sql: string
  /** notes worth showing to the user before they approve the DDL */
  warnings: string[]
}

/**
 * Builds the CREATE TABLE statement for `table` on the target, from the source columns.
 * `identifier` must be the target adapter's quoting function.
 */
export function buildCreateTable(
  table: string,
  sourceColumns: ColumnInfo[],
  from: DbType,
  to: DbType,
  identifier: (name: string) => string
): CreateTableSql {
  if (sourceColumns.length === 0) {
    throw new Error(`Source table "${table}" has no columns`)
  }
  const warnings: string[] = []
  const pkNames = sourceColumns.filter((c) => c.isPrimaryKey).map((c) => c.name)

  const lines = sourceColumns.map((col) => {
    const original = col.fullType || col.dataType
    let type = mapColumnType(col, from, to)
    let noted = false
    if (col.isPrimaryKey) {
      const safe = pkSafeType(type, to)
      if (safe !== type) {
        // One line for this column, not two: say where it started and why it moved.
        warnings.push(
          `${col.name}: ${original} → ${safe} (MySQL cannot use ${type} as a primary key)`
        )
        type = safe
        noted = true
      }
    }
    if (from !== to && !noted && original.toLowerCase() !== type.toLowerCase()) {
      warnings.push(`${col.name}: ${original} → ${type}`)
    }
    // A primary key is NOT NULL by definition on both engines.
    const notNull = !col.nullable || col.isPrimaryKey
    return `  ${identifier(col.name)} ${type}${notNull ? ' NOT NULL' : ''}`
  })

  if (pkNames.length > 0) {
    lines.push(`  PRIMARY KEY (${pkNames.map(identifier).join(', ')})`)
  } else {
    warnings.push('No primary key on the source — incremental sync will not work for this table')
  }

  const suffix = to === 'mysql' ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : ''
  const sql = `CREATE TABLE ${identifier(table)} (\n${lines.join(',\n')}\n)${suffix}`
  return { sql, warnings }
}
