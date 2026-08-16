import { app, ipcMain, shell, BrowserWindow } from 'electron'
import { createWriteStream, chmodSync, accessSync, constants } from 'node:fs'
import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type {
  UpdateCheckResult,
  UpdateDownloadResult,
  UpdateLogEvent,
  UpdateProgressEvent
} from '@shared/types'

const REPO = 'ocracy/dbferry'

interface GithubAsset {
  name: string
  size: number
  browser_download_url: string
}

interface GithubRelease {
  tag_name?: string
  name?: string
  html_url?: string
  published_at?: string
  draft?: boolean
  prerelease?: boolean
  assets?: GithubAsset[]
}

function compareVersions(a: string, b: string): number {
  const norm = (v: string) => v.replace(/^v/, '').split(/[-+]/)[0].split('.').map((n) => Number(n) || 0)
  const pa = norm(a)
  const pb = norm(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

function fmtBytes(n: number | null): string {
  if (n == null) return '?'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

const execFileAsync = promisify(execFile)

/** Escapes a path for safe interpolation into the single-quoted bash swap script. */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** `/Applications/dbferry.app` for a packaged mac build, null anywhere else. */
function macBundlePath(): string | null {
  if (process.platform !== 'darwin' || !app.isPackaged) return null
  const exe = app.getPath('exe') // …/dbferry.app/Contents/MacOS/dbferry
  const idx = exe.indexOf('.app/')
  return idx === -1 ? null : exe.slice(0, idx + 4)
}

/**
 * A self-update rewrites the bundle in place, so both the bundle and the directory
 * holding it must be writable — an app under /Applications installed by another user,
 * or one still running from a mounted DMG, falls back to the installer flow.
 */
function canSelfUpdateMac(): { bundle: string } | null {
  const bundle = macBundlePath()
  if (!bundle) return null
  if (bundle.startsWith('/Volumes/')) return null
  try {
    accessSync(bundle, constants.W_OK)
    accessSync(dirname(bundle), constants.W_OK)
    return { bundle }
  } catch {
    return null
  }
}

// Choose the release asset matching the running platform + architecture.
function pickAsset(
  assets: GithubAsset[],
  platform: NodeJS.Platform,
  arch: string,
  preferZip = false
): GithubAsset | undefined {
  const find = (pred: (name: string) => boolean) =>
    assets.find((a) => pred(a.name.toLowerCase()))
  if (platform === 'darwin') {
    // electron-builder names arm64 as "…-arm64.dmg" but x64 as plain "…-.dmg"
    // (no arch marker), so match x64 by the *absence* of an arm marker.
    const isArm = (n: string) => n.includes('arm64') || n.includes('aarch64')
    const wantArm = arch === 'arm64'
    const archMatch = (n: string) => (wantArm ? isArm(n) : !isArm(n))
    // The zip holds the .app bundle directly — that is what an in-place swap needs.
    if (preferZip) {
      const zip = find((n) => n.endsWith('.zip') && archMatch(n))
      if (zip) return zip
    }
    return (
      find((n) => n.endsWith('.dmg') && archMatch(n)) ||
      find((n) => n.endsWith('.zip') && archMatch(n)) ||
      find((n) => n.endsWith('.dmg'))
    )
  }
  if (platform === 'linux') {
    const wantArm = arch === 'arm64'
    return (
      find((n) => n.endsWith('.appimage') && (wantArm ? n.includes('arm64') || n.includes('aarch64') : !n.includes('arm'))) ||
      find((n) => n.endsWith('.appimage'))
    )
  }
  if (platform === 'win32') {
    return find((n) => n.endsWith('.exe')) || find((n) => n.endsWith('.zip'))
  }
  return undefined
}

async function fetchLatestRelease(currentVersion: string): Promise<GithubRelease> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `dbferry/${currentVersion}`
    }
  })
  if (!res.ok) throw new Error(`GitHub API responded ${res.status}`)
  return (await res.json()) as GithubRelease
}

/**
 * Unpacks the downloaded zip and hands the bundle swap to a detached bash script:
 * the running app cannot replace its own bundle, so the script waits for this
 * process to exit, swaps the directories, then relaunches the new build.
 * Returns the script path — the caller quits the app to let it proceed.
 */
async function stageMacSwap(
  zipPath: string,
  bundle: string,
  log: (level: UpdateLogEvent['level'], message: string) => void
): Promise<string> {
  const staging = await mkdtemp(join(tmpdir(), 'dbferry-update-'))
  log('info', 'Unpacking update…')
  // ditto (not unzip) — it preserves symlinks, permissions and code-signature metadata.
  await execFileAsync('/usr/bin/ditto', ['-x', '-k', zipPath, staging])

  const entries = await readdir(staging)
  const appName = entries.find((e) => e.endsWith('.app'))
  if (!appName) throw new Error(`No .app bundle inside ${zipPath}`)
  const newApp = join(staging, appName)
  log('info', `Unpacked ${appName}`)

  const scriptPath = join(staging, 'swap.sh')
  const logPath = join(staging, 'swap.log')
  const script = `#!/bin/bash
TARGET=${shellQuote(bundle)}
NEW=${shellQuote(newApp)}
STAGING=${shellQuote(staging)}
ZIP=${shellQuote(zipPath)}
BACKUP="$TARGET.dbferry-old"
exec >>${shellQuote(logPath)} 2>&1

# Wait for dbferry to exit — up to 30s, then stop waiting politely.
for _ in $(seq 1 300); do
  kill -0 ${process.pid} 2>/dev/null || break
  sleep 0.1
done
kill -0 ${process.pid} 2>/dev/null && kill -TERM ${process.pid} 2>/dev/null
sleep 0.5

rm -rf "$BACKUP"
if ! mv "$TARGET" "$BACKUP"; then
  echo "could not move the old bundle aside"
  open "$TARGET"
  exit 1
fi
if ditto "$NEW" "$TARGET"; then
  xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null
  rm -rf "$BACKUP" "$ZIP"
  echo "installed"
else
  echo "install failed — restoring the previous version"
  rm -rf "$TARGET"
  mv "$BACKUP" "$TARGET"
fi
open "$TARGET"
`
  await writeFile(scriptPath, script, { mode: 0o755 })
  return scriptPath
}

export function registerUpdateIpc(getWindow: () => BrowserWindow | null): void {
  const emitLog = (level: UpdateLogEvent['level'], message: string) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('update:log', { level, message, ts: Date.now() } satisfies UpdateLogEvent)
    }
  }
  const emitProgress = (p: UpdateProgressEvent) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send('update:progress', p)
  }

  ipcMain.handle('update:check', async (): Promise<UpdateCheckResult> => {
    const currentVersion = app.getVersion()
    const base: UpdateCheckResult = {
      currentVersion,
      latestVersion: null,
      hasUpdate: false,
      releaseUrl: null,
      releaseName: null,
      publishedAt: null
    }
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `dbferry/${currentVersion}`
        }
      })
      if (res.status === 404) return base
      if (!res.ok) return { ...base, error: `GitHub ${res.status}` }
      const data = (await res.json()) as GithubRelease
      if (data.draft || data.prerelease || !data.tag_name) return base
      const latestVersion = data.tag_name.replace(/^v/, '')
      const hasUpdate = compareVersions(latestVersion, currentVersion) > 0
      return {
        currentVersion,
        latestVersion,
        hasUpdate,
        releaseUrl: data.html_url ?? `https://github.com/${REPO}/releases/latest`,
        releaseName: data.name ?? data.tag_name,
        publishedAt: data.published_at ?? null
      }
    } catch (err) {
      return { ...base, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('update:open', async (_, url: unknown): Promise<boolean> => {
    if (typeof url !== 'string' || !/^https:\/\//.test(url)) return false
    await shell.openExternal(url)
    return true
  })

  // Downloads the matching release asset, streaming progress + logs to the renderer,
  // then opens the installer (dmg on mac / AppImage on linux) for the user to finish.
  ipcMain.handle('update:download', async (): Promise<UpdateDownloadResult> => {
    const currentVersion = app.getVersion()
    const fail = (error: string): UpdateDownloadResult => {
      emitLog('error', error)
      return { ok: false, filePath: null, assetName: null, error }
    }
    try {
      emitLog('info', `Current version: v${currentVersion} · ${process.platform}/${process.arch}`)
      emitLog('info', 'Fetching latest release from GitHub…')
      const release = await fetchLatestRelease(currentVersion)
      if (!release.tag_name) return fail('Latest release has no tag')
      const assets = release.assets ?? []
      emitLog('info', `Latest release: ${release.tag_name} · ${assets.length} asset(s)`)
      if (assets.length === 0) return fail('Release has no downloadable assets')

      const selfUpdate = canSelfUpdateMac()
      if (selfUpdate) {
        emitLog('info', `Will replace ${selfUpdate.bundle} in place`)
      } else if (process.platform === 'darwin') {
        emitLog('warn', 'In-place update not possible here — falling back to the disk image')
      }

      const asset = pickAsset(assets, process.platform, process.arch, !!selfUpdate)
      if (!asset) {
        return fail(
          `No compatible installer for ${process.platform}/${process.arch}. Available: ${assets
            .map((a) => a.name)
            .join(', ')}`
        )
      }
      emitLog('info', `Selected: ${asset.name} (${fmtBytes(asset.size)})`)

      const destPath = join(app.getPath('downloads'), asset.name)
      emitLog('info', `Saving to ${destPath}`)

      const res = await fetch(asset.browser_download_url, {
        headers: { 'User-Agent': `dbferry/${currentVersion}` },
        redirect: 'follow'
      })
      if (!res.ok || !res.body) return fail(`Download failed: HTTP ${res.status}`)

      const total = Number(res.headers.get('content-length')) || asset.size || null
      const stream = createWriteStream(destPath)
      const reader = res.body.getReader()
      let received = 0
      let lastLoggedPct = -1
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = Buffer.from(value)
          if (!stream.write(chunk)) {
            await new Promise<void>((resolve) => stream.once('drain', () => resolve()))
          }
          received += chunk.length
          const percent = total ? Math.floor((received / total) * 100) : null
          emitProgress({ received, total, percent })
          if (percent != null && percent >= lastLoggedPct + 10) {
            lastLoggedPct = percent - (percent % 10)
            emitLog('info', `Downloading… ${percent}% (${fmtBytes(received)} / ${fmtBytes(total)})`)
          }
        }
      } finally {
        await new Promise<void>((resolve, reject) =>
          stream.end((err?: Error | null) => (err ? reject(err) : resolve()))
        )
      }
      emitLog('info', `Download complete: ${fmtBytes(received)}`)

      if (process.platform === 'linux') {
        try {
          chmodSync(destPath, 0o755)
          emitLog('info', 'Marked AppImage as executable')
        } catch (err) {
          emitLog('warn', `Could not chmod AppImage: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      // Preferred path on macOS: swap the bundle ourselves and relaunch — no DMG,
      // no dragging, and no "the app is open" error.
      if (selfUpdate && asset.name.toLowerCase().endsWith('.zip')) {
        try {
          const scriptPath = await stageMacSwap(destPath, selfUpdate.bundle, emitLog)
          emitLog('info', 'Installing update and restarting dbferry…')
          spawn('/bin/bash', [scriptPath], { detached: true, stdio: 'ignore' }).unref()
          // Give the renderer a moment to paint the final log line before we go.
          setTimeout(() => app.quit(), 1200)
          return {
            ok: true,
            filePath: destPath,
            assetName: asset.name,
            mode: 'self-update',
            quitting: true
          }
        } catch (err) {
          emitLog(
            'warn',
            `In-place update failed: ${err instanceof Error ? err.message : String(err)}`
          )
          emitLog('info', 'Falling back to opening the downloaded file…')
        }
      }

      emitLog('info', 'Opening installer…')
      const openErr = await shell.openPath(destPath)
      if (openErr) {
        emitLog('warn', `Could not auto-open installer: ${openErr}`)
        emitLog('info', `File is saved at ${destPath} — open it manually.`)
        return { ok: true, filePath: destPath, assetName: asset.name, mode: 'installer' }
      }
      if (process.platform === 'darwin') {
        // Quit before the user drags: macOS refuses to overwrite a running bundle.
        emitLog('info', 'DMG opened. Quitting dbferry so you can drop it into Applications…')
        setTimeout(() => app.quit(), 2000)
        return {
          ok: true,
          filePath: destPath,
          assetName: asset.name,
          mode: 'installer',
          quitting: true
        }
      }
      emitLog('info', 'Installer opened.')
      return { ok: true, filePath: destPath, assetName: asset.name, mode: 'installer' }
    } catch (err) {
      return fail(`Update failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  })
}
