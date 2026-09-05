/** Steam ID helpers. Steam64 = 76561197960265728 + accountId. */

const STEAM64_BASE = 76561197960265728n

export function accountIdToSteam64(accountId: number): string {
  return (STEAM64_BASE + BigInt(accountId)).toString()
}

export function steam64ToAccountId(steam64: string): number | undefined {
  if (!isSteam64(steam64)) return undefined
  const acc = BigInt(steam64) - STEAM64_BASE
  if (acc < 0n || acc > 0xffffffffn) return undefined
  return Number(acc)
}

export function steam2ToAccountId(y: number, z: number): number {
  return z * 2 + y
}

export function isSteam64(value: string): boolean {
  return /^7656119\d{10}$/.test(value)
}

export function steamProfileUrl(steam64: string): string {
  return `https://steamcommunity.com/profiles/${steam64}`
}
