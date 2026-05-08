import { useEffect } from 'react'
import { Sidebar } from './layout/Sidebar'
import { ProjectsPage } from './projects/ProjectsPage'
import { ProjectDetailPage } from './projects/[id]/ProjectDetailPage'
import { HistoryPage } from './history/HistoryPage'
import { useRoute } from '@/stores/route'
import { useSync } from '@/stores/sync'
import { api } from '@/lib/api'
import { SyncStickyBar } from './components/SyncStickyBar'
import { JsonDropZone } from './components/JsonDropZone'

export function App() {
  const { route } = useRoute()
  const applyEvent = useSync((s) => s.applyEvent)

  useEffect(() => {
    const off = api.sync.onEvent((e) => applyEvent(e))
    return () => {
      off()
    }
  }, [applyEvent])

  return (
    <div className="h-screen w-screen flex bg-bg overflow-hidden">
      <div className="titlebar absolute top-0 left-0 right-0 h-9 z-50 pointer-events-none" />
      <Sidebar />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden relative">
        <div className="flex-1 overflow-auto">
          {route.name === 'projects' && <ProjectsPage />}
          {route.name === 'project' && <ProjectDetailPage projectId={route.id} />}
          {route.name === 'history' && <HistoryPage />}
        </div>
        <SyncStickyBar />
      </main>
      <JsonDropZone />
    </div>
  )
}
