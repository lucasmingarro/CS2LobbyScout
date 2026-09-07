import { describe, expect, it } from 'vitest'
import { extractFaceitMatchId } from '../src/shared/faceit-room'

const MATCH_ID = '1-e0112644-9e22-4c5e-a704-e5c78985df5d'

// A realistic community-server `status` excerpt (must never look like a room URL).
const STATUS_TEXT = `hostname: FACEIT.com register to play here
version : 1.40.4.4 secure  public
map     : de_mirage
# userid name uniqueid connected ping loss state rate
# 3 1 "aim.exe" [U:1:1234567] 06:53 32 0 active 786432
#end`

describe('extractFaceitMatchId', () => {
  // R1: plain English room URL
  it('extracts the id from a plain en room URL', () => {
    expect(extractFaceitMatchId(`https://www.faceit.com/en/cs2/room/${MATCH_ID}`)).toBe(MATCH_ID)
  })

  // R1: other language segment and trailing suffix
  it('accepts other language segments and trailing path segments', () => {
    expect(extractFaceitMatchId(`https://www.faceit.com/es/cs2/room/${MATCH_ID}/scoreboard`)).toBe(MATCH_ID)
    expect(extractFaceitMatchId(`https://www.faceit.com/pt-BR/cs2/room/${MATCH_ID}`)).toBe(MATCH_ID)
  })

  // R1: URL embedded in surrounding clipboard text
  it('finds the URL inside surrounding text', () => {
    const chat = `hey join us -> https://www.faceit.com/en/cs2/room/${MATCH_ID} gl hf`
    expect(extractFaceitMatchId(chat)).toBe(MATCH_ID)
  })

  it('accepts a bare match id as the whole input', () => {
    expect(extractFaceitMatchId(MATCH_ID)).toBe(MATCH_ID)
    expect(extractFaceitMatchId(`  ${MATCH_ID}\n`)).toBe(MATCH_ID)
  })

  // R2: unrelated text
  it('returns nothing for CS2 status output', () => {
    expect(extractFaceitMatchId(STATUS_TEXT)).toBeUndefined()
  })

  // R2: FACEIT URL that is not a match room
  it('returns nothing for a non-room FACEIT URL', () => {
    expect(extractFaceitMatchId('https://www.faceit.com/en/players/some_nickname')).toBeUndefined()
  })

  // R2: malformed id
  it('returns nothing for a malformed uuid', () => {
    expect(extractFaceitMatchId('https://www.faceit.com/en/cs2/room/1-not-a-uuid')).toBeUndefined()
    expect(extractFaceitMatchId('1-not-a-uuid')).toBeUndefined()
    expect(extractFaceitMatchId(`https://www.faceit.com/en/cs2/room/${MATCH_ID}ff`)).toBeUndefined()
  })
})
