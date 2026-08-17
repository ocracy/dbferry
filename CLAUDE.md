# dbferry

Cross-DB (MySQL ⇄ PostgreSQL) desktop sync tool. Each project pairs a source + target DB and syncs selected tables in `disabled` | `incremental` | `full` mode, manually or on a cron schedule.

## Stack

- **Electron 33** (main + preload + renderer) built with **electron-vite**
- **Renderer**: Vite + React 18 + TypeScript + Tailwind + Framer Motion + Zustand. No Next.js, no react-router — view switching is via a Zustand `useRoute` store.
- **Storage**: `better-sqlite3` at `app.getPath('userData')/dbferry.sqlite` (WAL, FK on)
- **Secrets**: `keytar` — service `dbferry`, accounts `${projectId}_source` / `${projectId}_target`. Never serialized into JSON exports.
- **DB drivers**: `mysql2/promise` + `pg` + `pg-cursor` + `pg-copy-streams`
- **Scheduling**: `node-cron`, per-project mutex prevents overlap
- **Concurrency**: `p-limit` for parallel tables (default 3)

## Layout

```
electron/
  main/
    index.ts                  app lifecycle, BrowserWindow, IPC wiring, schedule load
    ipc/                      projects | connection | sync | history | schema
    storage/                  sqlite + migrations + projects.repo + history.repo
    secrets/keytar.ts
    scheduler/cron.ts         per-project schedule + mutex + global emit
    sync-engine/
      adapters/{types,mysql,postgres}.ts
      type-mapper.ts          cross-DB coerceValue + intersectColumns
      schema-diff.ts          source↔target column diff + confirmed add/drop DDL
      ddl.ts                  cross-driver type mapping + CREATE TABLE generation
      engine.ts               runSync orchestration, transactions, progress events
  preload/index.ts            contextBridge → window.api (typed)
renderer/
  main.tsx + styles.css
  app/
    App.tsx                   root + sticky sync bar + JSON drop zone
    layout/Sidebar.tsx
    projects/ProjectsPage.tsx + NewProjectDialog.tsx
    projects/[id]/{ProjectDetailPage,ConnectionPanel,TablesGrid,ScheduleSelector,PasswordPrompt,SchemaDiffDialog,CreateTablesDialog}.tsx
    components/{SyncStickyBar,JsonDropZone}.tsx
    history/HistoryPage.tsx
  components/ui/{Button,Input,Card,Select,Badge}.tsx   shadcn-style minimal kit
  lib/{api,cn,format}.ts
  stores/{route,sync}.ts
shared/
  types.ts                    Project, TableConfig, SyncRun, SyncProgressEvent, etc.
  global.d.ts                 pg-cursor declaration
```

Path aliases: `@shared/*` → `shared/*`, `@/*` → `renderer/*`, `@main/*` → `electron/main/*`.

## Sync engine — performance contract

**Read** (streaming, batch=5000):
- PG source: `pg-cursor` `cursor.read(batchSize)` loop
- MySQL source: `mysql2` raw `connection.query({rowsAsArray:true}).stream({highWaterMark:50})`

**Write** (the hot path — keep this fast):
- PG target: `COPY tbl(cols) FROM STDIN WITH (FORMAT text)` via `pg-copy-streams`. Custom escape in `postgres.ts` (`\N` for null, `\\x` for buffers, JSON stringify for objects, PG-array literal for arrays).
- MySQL target: parametric multi-row `INSERT IGNORE INTO t (cols) VALUES (?,?),...` 1.000 rows/statement.

**Per-table flow** (`syncTable` in `engine.ts`):
1. Open separate source + target adapters per table (run in parallel via `p-limit`).
2. `intersectColumns(srcCols, tgtCols)` — columns missing on either side are warned, not aborted.
3. For `incremental`: `tgt.getMaxPk(table, pkColumn)` → `WHERE pk > ?` on source.
4. `tgt.setConstraintsDisabled(true)` → `BEGIN` → (if `full`) `TRUNCATE` → stream + coerce + `bulkWrite` → `COMMIT`.
5. `coerceValue(...)` runs row-by-row (TINYINT(1)↔BOOLEAN, DATETIME↔TIMESTAMP, JSON/JSONB, UUID↔CHAR(36), arrays).
6. Failure rolls back that table only; other tables continue. Cancel = `AbortSignal` propagated through stream + write.

**Progress** is emitted via `engine.ts → ipc/sync.ts → webContents.send('sync:event', ...)`. Renderer's Zustand `useSync` store aggregates these into `ActiveRun`, which `SyncStickyBar` and `TablesGrid` consume. The sticky bar is one global element in `App.tsx` — do not duplicate per-page.

## Sync semantics — important constraints

- **disabled** is the default for newly discovered tables — `TablesGrid.fetchTables` merges new source tables as `disabled`.
- **incremental** is append-only: only `pk > MAX(target.pk)` rows go through. Updates and deletes do **not** propagate. PK must be a single integer-like column. UUID/composite PKs are not supported in incremental mode (UI doesn't enforce yet — engine throws if MAX(pk) lookup fails).
- **full** is `TRUNCATE + COPY/INSERT` in a single transaction per table. Atomic per table, not across all tables.
- The engine **never creates tables during a sync**. A missing target table fails that table with a message pointing at *Create in target* — schema writes stay an explicit, reviewed step (see "Creating missing tables"). Column intersect handles minor mismatches; `bulkWrite` will fail loudly on type mismatch.
- Constraint disabling is session-scoped (`SET session_replication_role = 'replica'` on PG, `FOREIGN_KEY_CHECKS=0` on MySQL) and reset in `finally`.

## Column diff (source ⇄ target)

`TablesGrid` → **Compare columns** (or right-click a table → *Compare columns…*) opens `SchemaDiffDialog`.
Scope = selected rows, else all visible rows.

- `schema:diff` → `diffSchema()` reads `getColumns()` on both sides per table and reports
  `missing-in-target` (add), `extra-in-target` (drop), `enum-values` (add labels),
  `type-mismatch` (info only).
- **Enum labels** are compared whenever both sides have them, **including cross-driver** — the
  label set is comparable even when the type names are not. MySQL carries them in `COLUMN_TYPE`
  (parsed by `parseMysqlEnumValues`); PostgreSQL does not expose them in `information_schema` at
  all, so `PostgresAdapter.enumLabels` joins `pg_type`/`pg_enum` — without it, `ALTER TYPE … ADD
  VALUE` on the source is invisible. A column with an enum diff never also emits a
  `type-mismatch`, which would just repeat the label list.
- Adding labels is applicable (`ALTER TYPE … ADD VALUE IF NOT EXISTS` on PG, `MODIFY COLUMN` with
  the widened list on MySQL, carrying charset/default/comment over); labels only the target has
  are reported but never removed.
- Type comparison only runs when source and target share a driver — `varchar(255)` vs
  `character varying(255)` would otherwise flag every column.
- Fixable: add only same-driver (no cross-driver type translation); drop always, except PK columns.
  Type mismatches are never auto-fixed — `ALTER TYPE` can lose data.
- `schema:applyFixes` runs the user-checked actions on the **target only**, one by one; a failing
  action does not abort the rest. Nothing is pre-selected — the dialog is a flat
  table/column/change list with per-row checkboxes, a text filter and add/drop/type chips.
- A table **gone from the source** (`missingOnSource`) yields no column rows at all — every target
  column would otherwise read as a drop. It gets one notice line; the table list already flags it.
- No `CREATE TABLE` here: a table missing on the target is reported and handed to the create flow.

## Conventions

- All DB identifiers are quoted via `adapter.identifier(name)` — never interpolate raw names into SQL.
- All values flow through `coerceValue` before write. Add new cross-DB type rules there, not in adapters.
- Engine never reads passwords directly — always `secrets.getPassword(projectId, side)`.
- Renderer ↔ main only via `window.api` (typed in `electron/preload/index.ts`). Do not add `ipcRenderer` calls from renderer.
- New IPC: handler in `electron/main/ipc/*.ts`, register in `electron/main/index.ts`, expose in preload, type-leak via `DbferryApi`.
- New schema change: add a new entry to `MIGRATIONS` array in `electron/main/storage/migrations.ts` with the next `id`. Never edit a past migration.
- History retention: 500 runs, pruned in `historyRepo.finishRun`.
- UI tone: dark, glassmorphism (`.glass`), accent `hsl(255,90%,66%)`. Use `Button`/`Input`/`Card`/`Badge` from `components/ui/`.

## JSON project format (export/import)

`{ version: 1, name, source, target, tables: [{name, mode, pkColumn}], schedule: {enabled, cron}, tableConcurrency }`

Drag-drop on the window triggers `JsonDropZone` → `api.projects.importJson({content})` → name collision resolves with `(2)` suffix. Passwords are not in the file; user must re-enter via `PasswordPrompt`.

## Creating missing tables

A table that exists on the source but not on the target is surfaced, never created behind the
user's back — schema writes are always an explicit, reviewed step.

- `TablesGrid.refreshMissing` (runs on **Refresh**) diffs the source table list against
  `connection:listTables` on the target. The result drives a `not in target` filter chip, a
  per-row badge, and the header's **Create N in target** button. Sync entries in the row's
  context menu are disabled for those tables.
- `schema:planCreateTables` → `planCreateTables()` builds the DDL **without running it**;
  `CreateTablesDialog` shows the statement per table plus the type-translation warnings, and only
  `schema:createTables` executes the approved ones.
- `ddl.ts` owns the translation. Same driver keeps `fullType` verbatim; cross-driver goes through
  `mysqlToPg` / `pgToMysql` (`tinyint(1)`↔`boolean`, `datetime`↔`timestamp`, `json`↔`jsonb`,
  `uuid`→`char(36)`, arrays→`json`, unsigned widening, …). A text/blob primary key is narrowed to
  `varchar(255)` because MySQL cannot index it otherwise.
- Enum columns get a real enum on the target: a PG target receives a `CREATE TYPE … AS ENUM`
  prelude (idempotent via `DO $$ … EXCEPTION WHEN duplicate_object`), a MySQL target gets the
  labels re-declared inline. `planCreateTables` shows the prelude together with the table.
- Generated tables carry columns, nullability and the primary key — nothing else. Add new type
  rules in `ddl.ts`, next to the value rules in `type-mapper.ts`.

## In-app updater (`electron/main/ipc/update.ts`)

Builds are unsigned, so electron-updater/Squirrel is not usable — the updater is hand-rolled
against the GitHub releases API of `ocracy/dbferry`.

- **macOS, packaged, bundle writable** (`canSelfUpdateMac`): downloads the arch-matched **zip**,
  `ditto -x -k` into a temp staging dir, writes a detached bash script and quits. The script waits
  for the old PID to exit, `mv`s the bundle aside, `ditto`s the new one in place, strips the
  quarantine xattr and `open`s the app. A failed `ditto` restores the backup — the user is never
  left without an app. No DMG, no dragging.
- **Otherwise** (dev, app on a mounted DMG or non-writable bundle): downloads the dmg/AppImage and
  opens it. On macOS the app then **quits itself**, because macOS refuses to overwrite a running
  bundle while the user drags.
- The running build's updater does the updating, so changes here only take effect on the
  version *after* the one being released.
- `pickAsset` matches x64 by the *absence* of an arm marker — electron-builder names arm64 assets
  `…-arm64.dmg` but x64 ones plain `….dmg`.

## Dev / build

```bash
pnpm install        # native modules: better-sqlite3, keytar — pre-approved in package.json's pnpm.onlyBuiltDependencies
pnpm dev            # electron-vite, renderer at :5173
pnpm typecheck      # tsc --noEmit
pnpm build          # production bundle
pnpm build:mac      # .dmg in release/
pnpm build:linux    # .AppImage in release/
```

If you change anything in `electron/main` or `electron/preload`, electron-vite restarts the main process. Renderer hot-reloads.

## Known limitations / V2 ideas

- Generated `CREATE TABLE` covers columns, nullability and the primary key only — no indexes, defaults, foreign keys, auto-increment or collations.
- No timestamp-based incremental (only `MAX(pk)` watermark).
- No composite/UUID PK incremental.
- No bidirectional sync, no conflict resolution.
- No ID-range parallel reads on a single table — single cursor per table is the bottleneck on very large tables.
- Sync runs in main process (not `worker_threads`). I/O is libuv-backed; CPU-bound coercion is the only place where main-thread latency could matter.

## Files most often touched

- New cross-DB type quirk: `electron/main/sync-engine/type-mapper.ts`
- New adapter capability: `electron/main/sync-engine/adapters/{mysql,postgres}.ts` + `types.ts`
- New IPC: see "Conventions" above
- UI changes per project: `renderer/app/projects/[id]/*`
- Sync UX (sticky bar / progress): `renderer/app/components/SyncStickyBar.tsx` + `renderer/stores/sync.ts`
