import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import { useStore } from '../store'
import type { EngineId } from '@shared/types'

export function Toast() {
  const toast = useStore((s) => s.toast)
  if (!toast) return null
  return (
    <div
      className={`fixed bottom-10 left-1/2 z-50 -translate-x-1/2 rounded-lg border px-4 py-2 shadow-xl ${
        toast.level === 'error' ? 'border-err/60 bg-panel2 text-err' : 'border-line bg-raised text-fg'
      }`}
    >
      {toast.text}
    </div>
  )
}

export function Modal({ title, onClose, children, width = 560, footer }: { title: string; onClose: () => void; children: ReactNode; width?: number; footer?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-6" onMouseDown={onClose}>
      <div className="flex max-h-full flex-col rounded-xl border border-line bg-panel shadow-2xl" style={{ width }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export interface MenuOption<T extends string> {
  value: T
  label: string
  hint?: string
  icon?: ReactNode
}

/** Compact dropdown used for engine / model / mode pickers. */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  label,
  className = '',
  align = 'left',
  up = false,
  allowCustom
}: {
  value: T
  options: MenuOption<T>[]
  onChange: (v: T) => void
  label?: ReactNode
  className?: string
  align?: 'left' | 'right'
  up?: boolean
  allowCustom?: string
}) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [open])
  const cur = options.find((o) => o.value === value)
  return (
    <div className={`relative no-drag ${className}`} ref={ref}>
      <button className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-[12.5px] text-muted hover:bg-raised hover:text-fg" onClick={() => setOpen((v) => !v)}>
        {label ?? (
          <>
            {cur?.icon}
            <span>{cur?.label ?? value}</span>
          </>
        )}
        <ChevronDown size={13} className="opacity-60" />
      </button>
      {open && (
        <div
          className={`absolute z-30 min-w-[220px] rounded-lg border border-line bg-raised p-1 shadow-xl ${align === 'right' ? 'right-0' : 'left-0'} ${
            up ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          {options.map((o) => (
            <button
              key={o.value}
              className="flex w-full items-start gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-panel2"
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
            >
              <span className="mt-0.5 w-4">{o.value === value ? <Check size={14} className="text-accent" /> : o.icon}</span>
              <span className="flex-1">
                <span className="block text-[13px] text-fg">{o.label}</span>
                {o.hint && <span className="block text-[11.5px] text-faint">{o.hint}</span>}
              </span>
            </button>
          ))}
          {allowCustom && (
            <form
              className="border-t border-line p-1.5"
              onSubmit={(e) => {
                e.preventDefault()
                if (custom.trim()) onChange(custom.trim() as T)
                setCustom('')
                setOpen(false)
              }}
            >
              <input className="field w-full text-[12.5px]" placeholder={allowCustom} value={custom} onChange={(e) => setCustom(e.target.value)} />
            </form>
          )}
        </div>
      )}
    </div>
  )
}

export function EngineDot({ engine, size = 8 }: { engine: EngineId; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: `var(--${engine})` }} />
}

export const ENGINE_LABEL: Record<EngineId, string> = { claude: 'Claude', codex: 'Codex' }

export function StatusPill({ status }: { status: string }) {
  const color: Record<string, string> = {
    idea: 'var(--faint)',
    outlined: 'var(--warn)',
    drafted: 'var(--accent)',
    revised: 'var(--codex)',
    final: 'var(--ok)'
  }
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full" title={status} style={{ background: color[status] ?? 'var(--faint)' }} />
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-6 text-center text-[12.5px] text-faint">{children}</div>
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`
  return new Date(ts).toLocaleDateString()
}
