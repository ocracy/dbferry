import type { DbferryApi } from '../../electron/preload'

declare global {
  interface Window {
    api: DbferryApi
  }
}

export const api = (typeof window !== 'undefined' ? window.api : ({} as DbferryApi))
