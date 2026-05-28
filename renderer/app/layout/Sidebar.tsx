import { Database, History, Layers } from 'lucide-react'
import { useRoute } from '@/stores/route'
import { cn } from '@/lib/cn'
import { ConsoleSidebarRow } from '@/app/components/ConsolePanel'

import type { Route } from '@/stores/route'

interface NavItem {
  label: string
  icon: typeof Database
  match: (route: Route) => boolean
  go: () => void
}

export function Sidebar() {
  const { route, go } = useRoute()

  const items: NavItem[] = [
    {
      label: 'Projects',
      icon: Layers,
      match: (r) => r.name === 'projects' || r.name === 'project',
      go: () => go({ name: 'projects' })
    },
    {
      label: 'History',
      icon: History,
      match: (r) => r.name === 'history',
      go: () => go({ name: 'history' })
    }
  ]

  return (
    <aside className="w-56 shrink-0 h-full glass border-r border-line/40 flex flex-col">
      <div className="titlebar h-9" />
      <div className="px-5 pb-3 pt-1 flex items-center gap-2.5">
        <div className="size-7 rounded-lg bg-gradient-to-br from-accent to-accent-hover grid place-items-center shadow-[0_8px_24px_-12px_rgba(120,80,255,0.7)]">
          <Database className="size-4 text-white" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-[13px] font-semibold tracking-tight">dbferry</span>
          <span className="text-[10px] text-text-muted">cross-db sync</span>
        </div>
      </div>
      <nav className="px-3 py-3 space-y-0.5">
        {items.map((item) => {
          const active = item.match(route)
          const Icon = item.icon
          return (
            <button
              key={item.label}
              onClick={item.go}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 h-9 rounded-lg text-[13px] font-medium transition-colors',
                active ? 'bg-bg-panel text-text' : 'text-text-muted hover:text-text hover:bg-bg-panel/60'
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </button>
          )
        })}
      </nav>
      <div className="mt-auto">
        <ConsoleSidebarRow />
        <div className="p-4 text-[10.5px] text-text-muted/70 border-t border-line/40">
          Drag a <span className="font-mono text-text-muted">.dbferry.json</span> file anywhere to import a project.
        </div>
      </div>
    </aside>
  )
}
