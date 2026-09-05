import type { JSX } from 'react'
import type { SourceStatuses } from '@shared/types'
import { sourceLabel } from '../format'

export function Sources({ s }: { s: SourceStatuses }): JSX.Element {
  return (
    <span
      className="src"
      title={`Steam: ${sourceLabel[s.steam]} · Valve/Leetify: ${sourceLabel[s.valve]} · FACEIT: ${sourceLabel[s.faceit]} · History: ${sourceLabel[s.history]}`}
    >
      <span className={s.steam} />
      <span className={s.valve} />
      <span className={s.faceit} />
      <span className={s.history} />
    </span>
  )
}
