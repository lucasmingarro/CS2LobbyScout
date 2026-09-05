import type { ConfigStore } from './config'
import type { Repositories } from './db/repositories'
import type { ScoutService } from './services/scout-service'
import type { BanRecheckService } from './services/ban-recheck'
import type { ClipboardWatcher } from './clipboard-watcher'

/** Everything the IPC layer needs, built once in main/index.ts. */
export interface AppContext {
  version: string
  userDataPath: string
  config: ConfigStore
  repos: Repositories
  scout: ScoutService
  banRecheck: BanRecheckService
  clipboardWatcher: ClipboardWatcher
}
