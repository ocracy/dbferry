import { app, ipcMain, shell, BrowserWindow } from 'electron'
import { createWriteStream, chmodSync } from 'node:fs'
import { join } from 'node:path'
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

// Choose the release asset matching the running platform + architecture.
function pickAsset(assets: GithubAsset[], platform: NodeJS.Platform, arch: string): GithubAsset | undefined {
  const find = (pred: (name: string) => boolean) =>
    assets.find((a) => pred(a.name.toLowerCase()))
  if (platform === 'darwin') {
    const wantArm = arch === 'arm64'
    return (
      find((n) => n.endsWith('.dmg') && (wantArm ? n.includes('arm64') : n.includes('x64') || n.includes('x86_64'))) ||
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

      const asset = pickAsset(assets, process.platform, process.arch)
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

      emitLog('info', 'Opening installer…')
      const openErr = await shell.openPath(destPath)
      if (openErr) {
        emitLog('warn', `Could not auto-open installer: ${openErr}`)
        emitLog('info', `File is saved at ${destPath} — open it manually.`)
      } else if (process.platform === 'darwin') {
        emitLog('info', 'DMG opened. Drag dbferry into Applications to finish, then relaunch.')
      } else {
        emitLog('info', 'Installer opened.')
      }

      return { ok: true, filePath: destPath, assetName: asset.name }
    } catch (err) {
      return fail(`Update failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  })
}
