/**
 * Recognizer for FACEIT CS2 match room URLs. Pure (no Node APIs) so both the
 * renderer paste path and the main-process clipboard watcher can use it.
 */

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'

/** Room URL anywhere in the text: any language segment, optional trailing segments. */
const ROOM_URL = new RegExp(`https://(?:www\\.)?faceit\\.com/[a-zA-Z-]+/cs2/room/(1-${UUID})(?![0-9a-fA-F-])`)

/** A bare match id, accepted only when it is the whole (trimmed) input. */
const BARE_ID = new RegExp(`^1-${UUID}$`)

/**
 * Extracts the FACEIT match id (`1-<uuid>`) from text containing a match room
 * URL (`https://www.faceit.com/<lang>/cs2/room/1-<uuid>[/...]`), or from a bare
 * match id. Returns undefined when no valid id is present.
 */
export function extractFaceitMatchId(text: string): string | undefined {
  const url = ROOM_URL.exec(text)
  if (url) return url[1]
  const trimmed = text.trim()
  return BARE_ID.test(trimmed) ? trimmed : undefined
}
