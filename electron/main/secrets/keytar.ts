import keytar from 'keytar'

const SERVICE = 'dbferry'

type Side = 'source' | 'target'

function accountKey(projectId: string, side: Side): string {
  return `${projectId}_${side}`
}

const EMPTY_MARKER = '__dbferry_empty__'

function decode(stored: string | null): string | null {
  if (stored === null) return null
  if (stored === EMPTY_MARKER) return ''
  return stored
}

export const secrets = {
  async getPassword(projectId: string, side: Side): Promise<string | null> {
    const v = await keytar.getPassword(SERVICE, accountKey(projectId, side))
    return decode(v)
  },
  async setPassword(projectId: string, side: Side, password: string): Promise<void> {
    const toStore = password === '' ? EMPTY_MARKER : password
    await keytar.setPassword(SERVICE, accountKey(projectId, side), toStore)
  },
  async deletePassword(projectId: string, side: Side): Promise<boolean> {
    return keytar.deletePassword(SERVICE, accountKey(projectId, side))
  },
  async deleteAll(projectId: string): Promise<void> {
    await keytar.deletePassword(SERVICE, accountKey(projectId, 'source'))
    await keytar.deletePassword(SERVICE, accountKey(projectId, 'target'))
  },
  async hasBoth(projectId: string): Promise<boolean> {
    const [s, t] = await Promise.all([
      keytar.getPassword(SERVICE, accountKey(projectId, 'source')),
      keytar.getPassword(SERVICE, accountKey(projectId, 'target'))
    ])
    return s !== null && t !== null
  },
  async status(projectId: string): Promise<{ source: boolean; target: boolean }> {
    const [s, t] = await Promise.all([
      keytar.getPassword(SERVICE, accountKey(projectId, 'source')),
      keytar.getPassword(SERVICE, accountKey(projectId, 'target'))
    ])
    return { source: s !== null, target: t !== null }
  }
}
