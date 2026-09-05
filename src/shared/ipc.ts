/** IPC channel names shared between main and preload. */
export const IPC = {
  // renderer -> main (invoke)
  LOBBY_PARSE_PREVIEW: 'lobby:parse-preview',
  LOBBY_LOAD: 'lobby:load',
  LOBBY_SET_TEAM: 'lobby:set-team',
  PLAYER_REFRESH: 'player:refresh',
  PLAYER_HISTORY: 'player:history',
  PLAYER_WATCH: 'player:watch',
  WATCHED_LIST: 'watched:list',
  WATCHED_RECHECK: 'watched:recheck',
  BANS_LIST: 'bans:list',
  BANS_ACK: 'bans:ack',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  KEYS_STATUS: 'keys:status',
  KEYS_SET: 'keys:set',
  CACHE_CLEAR: 'cache:clear',
  HISTORY_CLEAR: 'history:clear',
  OPEN_EXTERNAL: 'shell:open-external',
  APP_INFO: 'app:info',
  // main -> renderer (send)
  EVT_LOBBY_DETECTED: 'evt:lobby-detected',
  EVT_PLAYER_UPDATED: 'evt:player-updated',
  EVT_BAN_DETECTED: 'evt:ban-detected',
  EVT_LOG: 'evt:log'
} as const
