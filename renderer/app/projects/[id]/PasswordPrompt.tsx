import { useState } from 'react'
import { X, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

export function PasswordPrompt({
  side,
  onCancel,
  onSave
}: {
  side: 'source' | 'target'
  onCancel: () => void
  onSave: (password: string) => void
}) {
  const [password, setPassword] = useState('')
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-bg/60 backdrop-blur-sm">
      <div className="glass rounded-2xl w-[420px] max-w-[92vw]">
        <div className="px-5 py-4 flex items-center justify-between border-b border-line/40">
          <h3 className="font-semibold flex items-center gap-2">
            <KeyRound className="size-4" /> {side === 'source' ? 'Source' : 'Target'} password
          </h3>
          <button onClick={onCancel} className="text-text-muted hover:text-text">
            <X className="size-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-text-muted">
            Stored securely in your OS keychain. Never written to JSON exports.
          </p>
          <Input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSave(password)
            }}
          />
        </div>
        <div className="px-5 py-4 flex justify-end gap-2 border-t border-line/40">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onSave(password)}>
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}
