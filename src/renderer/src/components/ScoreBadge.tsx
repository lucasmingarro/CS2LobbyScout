import type { JSX } from 'react'
import type { ScoutPlayer } from '@shared/types'
import { scoreAvailable } from '../format'

export function ScoreBadge({ player, large = false }: { player: ScoutPlayer; large?: boolean }): JSX.Element {
  if (!scoreAvailable(player)) {
    const pending = player.sources.faceit === 'pending' || player.sources.valve === 'pending'
    return <span className={`score na ${large ? 'lg' : ''}`}>{pending ? '…' : 'n/a'}</span>
  }
  return <span className={`score ${player.scout.level} ${large ? 'lg' : ''}`}>{player.scout.score}</span>
}
