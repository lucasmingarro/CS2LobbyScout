import type { JSX } from 'react'
export interface Toast {
  id: number
  kind: 'info' | 'danger'
  title: string
  body?: string
  actionLabel?: string
  onAction?: () => void
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }): JSX.Element | null {
  if (toasts.length === 0) return null
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <div className="body">
            <div>{t.title}</div>
            {t.body && <small>{t.body}</small>}
          </div>
          {t.actionLabel && (
            <button
              className="btn sm primary"
              onClick={() => {
                t.onAction?.()
                onDismiss(t.id)
              }}
            >
              {t.actionLabel}
            </button>
          )}
          <button className="btn sm ghost" onClick={() => onDismiss(t.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
