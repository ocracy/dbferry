import { app, ipcMain, shell } from 'electron'

const REPO = 'ocracy/dbferry'

export interface UpdateCheckResult {
  currentVersion: string
  latestVersion: string | null
  hasUpdate: boolean
  releaseUrl: string | null
  releaseName: string | null
  publishedAt: string | null
  error?: string
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

export function registerUpdateIpc(): void {
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
      const data = (await res.json()) as {
        tag_name?: string
        name?: string
        html_url?: string
        published_at?: string
        draft?: boolean
        prerelease?: boolean
      }
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
}
