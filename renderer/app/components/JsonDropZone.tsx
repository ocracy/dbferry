import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FileJson } from 'lucide-react'
import { api } from '@/lib/api'
import { useRoute } from '@/stores/route'
import { toast } from 'sonner'

export function JsonDropZone() {
  const [over, setOver] = useState(false)
  const { go } = useRoute()

  useEffect(() => {
    let counter = 0
    const onEnter = (e: DragEvent) => {
      e.preventDefault()
      counter++
      if (e.dataTransfer?.types.includes('Files')) setOver(true)
    }
    const onLeave = () => {
      counter--
      if (counter <= 0) {
        counter = 0
        setOver(false)
      }
    }
    const onOver = (e: DragEvent) => e.preventDefault()
    const onDrop = async (e: DragEvent) => {
      e.preventDefault()
      counter = 0
      setOver(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length === 0) return
      let imported = 0
      for (const file of files) {
        if (!file.name.endsWith('.json')) continue
        try {
          const content = await file.text()
          const project = await api.projects.importJson({ content })
          imported++
          toast.success(`Imported "${project.name}"`)
          go({ name: 'project', id: project.id })
        } catch (err) {
          toast.error(`Failed to import ${file.name}: ${err instanceof Error ? err.message : err}`)
        }
      }
      if (imported === 0) toast.error('No valid .json file found')
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [go])

  return (
    <AnimatePresence>
      {over && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] pointer-events-none grid place-items-center"
        >
          <div className="absolute inset-4 rounded-3xl border-2 border-dashed border-accent/60 bg-accent/5 backdrop-blur-md" />
          <motion.div
            initial={{ scale: 0.96, y: 6 }}
            animate={{ scale: 1, y: 0 }}
            className="relative glass rounded-2xl px-8 py-6 flex items-center gap-4 shadow-2xl"
          >
            <div className="size-12 rounded-xl bg-accent/20 grid place-items-center">
              <FileJson className="size-6 text-accent" />
            </div>
            <div>
              <div className="text-base font-semibold">Drop to import project</div>
              <div className="text-xs text-text-muted">Each .json becomes a new project.</div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
