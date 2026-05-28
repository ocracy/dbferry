import type { ColumnInfo, DbType } from '@shared/types'

function norm(s: string): string {
  return s.trim().toLowerCase()
}

function looksLikeBoolText(t: string): boolean {
  return norm(t).startsWith('tinyint(1)') || norm(t) === 'boolean' || norm(t) === 'bool'
}

export function coerceValue(
  value: unknown,
  source: DbType,
  target: DbType,
  sourceCol: ColumnInfo,
  targetCol: ColumnInfo
): unknown {
  if (value === null || value === undefined) return null

  const tgtType = norm(targetCol.dataType)

  // JSON/JSONB target — always serialize objects/arrays. Driver auto-parsers
  // (mysql2, pg) hand back parsed objects which would otherwise be passed to
  // mysql2 as parameter and serialized as a SET-style key=value clause.
  if (tgtType === 'jsonb' || tgtType === 'json') {
    if (typeof value === 'string') return value
    if (Buffer.isBuffer(value)) return value.toString('utf8')
    return JSON.stringify(value)
  }

  if (source === target) {
    if (source === 'mysql' && (looksLikeBoolText(sourceCol.dataType) || looksLikeBoolText(targetCol.dataType))) {
      if (typeof value === 'number') return value === 1
    }
    // Same-driver fallback: object/array values for non-JSON columns also need
    // serialization so mysql2 doesn't render them as `k = v` pairs.
    if (target === 'mysql' && (typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value))) {
      return JSON.stringify(value)
    }
    return value
  }

  // Boolean handling
  if (tgtType === 'boolean' || tgtType === 'bool') {
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value !== 0
    if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true' || value.toLowerCase() === 't'
    return Boolean(value)
  }
  if (tgtType.startsWith('tinyint')) {
    if (typeof value === 'boolean') return value ? 1 : 0
  }

  // Datetime → timestamp string normalization
  if (tgtType === 'timestamp' || tgtType === 'timestamp without time zone' || tgtType === 'timestamp with time zone' || tgtType === 'datetime') {
    if (value instanceof Date) return value.toISOString().replace('T', ' ').replace('Z', '')
    if (typeof value === 'string') return value
  }

  // Arrays
  if (tgtType.endsWith('[]') || tgtType === 'array') {
    if (Array.isArray(value)) {
      if (target === 'mysql') return JSON.stringify(value)
      // PG array literal text representation
      const inner = value
        .map((v) => {
          if (v === null) return 'NULL'
          const s = String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
          return `"${s}"`
        })
        .join(',')
      return `{${inner}}`
    }
  }

  return value
}

export function intersectColumns(
  sourceCols: ColumnInfo[],
  targetCols: ColumnInfo[]
): { matched: Array<{ src: ColumnInfo; tgt: ColumnInfo }>; missingInTarget: string[]; missingInSource: string[] } {
  const tgtMap = new Map(targetCols.map((c) => [c.name.toLowerCase(), c]))
  const srcMap = new Map(sourceCols.map((c) => [c.name.toLowerCase(), c]))
  const matched: Array<{ src: ColumnInfo; tgt: ColumnInfo }> = []
  const missingInTarget: string[] = []
  for (const c of sourceCols) {
    const tgt = tgtMap.get(c.name.toLowerCase())
    if (tgt) matched.push({ src: c, tgt })
    else missingInTarget.push(c.name)
  }
  const missingInSource: string[] = []
  for (const c of targetCols) {
    if (!srcMap.has(c.name.toLowerCase())) missingInSource.push(c.name)
  }
  return { matched, missingInTarget, missingInSource }
}
