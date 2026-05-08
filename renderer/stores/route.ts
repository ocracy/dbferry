import { create } from 'zustand'

export type Route = { name: 'projects' } | { name: 'project'; id: string } | { name: 'history' }

interface RouteState {
  route: Route
  go: (r: Route) => void
}

export const useRoute = create<RouteState>((set) => ({
  route: { name: 'projects' },
  go: (route) => set({ route })
}))
