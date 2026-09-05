import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { safeStorage } from 'electron'
import { DEFAULT_SETTINGS, type ApiKeyStatus, type AppSettings } from '@shared/types'
import { logger } from './logger'

interface ConfigFile {
  settings: Partial<AppSettings>
  /** Keys stored by the Settings screen. Encrypted with safeStorage when available. */
  keys: { steam?: string; faceit?: string }
  keysEncrypted: boolean
}

const EMPTY: ConfigFile = { settings: {}, keys: {}, keysEncrypted: false }

export class ConfigStore {
  private file: string
  private data: ConfigFile = { ...EMPTY }

  constructor(userDataDir: string) {
    this.file = join(userDataDir, 'config.json')
    this.load()
  }

  private load(): void {
    try {
      if (existsSync(this.file)) {
        const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<ConfigFile>
        this.data = {
          settings: parsed.settings ?? {},
          keys: parsed.keys ?? {},
          keysEncrypted: !!parsed.keysEncrypted
        }
      }
    } catch (err) {
      logger.warn('config.load_failed', { error: (err as Error).message })
      this.data = { ...EMPTY }
    }
  }

  private save(): void {
    const dir = dirname(this.file)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.data, null, 2))
  }

  getSettings(): AppSettings {
    const settings = { ...DEFAULT_SETTINGS, ...this.data.settings }
    // Development convenience: MY_STEAM_ID from .env fills in when nothing is configured in the UI.
    if (!settings.mySteamId && process.env.MY_STEAM_ID?.trim()) settings.mySteamId = process.env.MY_STEAM_ID.trim()
    return settings
  }

  setSettings(patch: Partial<AppSettings>): AppSettings {
    this.data.settings = { ...this.data.settings, ...patch }
    this.save()
    return this.getSettings()
  }

  // ---- API keys --------------------------------------------------------------

  private canEncrypt(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  private decrypt(value: string | undefined): string | undefined {
    if (!value) return undefined
    if (!this.data.keysEncrypted) return value
    try {
      return safeStorage.decryptString(Buffer.from(value, 'base64'))
    } catch (err) {
      logger.warn('config.key_decrypt_failed', { error: (err as Error).message })
      return undefined
    }
  }

  /** Env vars (dev `.env` or real environment) take precedence over stored keys. */
  getKey(which: 'steam' | 'faceit'): { value?: string; source: 'env' | 'settings' | 'none' } {
    const env = which === 'steam' ? process.env.STEAM_API_KEY : process.env.FACEIT_API_KEY
    if (env && env.trim()) return { value: env.trim(), source: 'env' }
    const stored = this.decrypt(this.data.keys[which])
    if (stored && stored.trim()) return { value: stored.trim(), source: 'settings' }
    return { source: 'none' }
  }

  setKeys(keys: { steam?: string; faceit?: string }): void {
    const encrypt = this.canEncrypt()
    // Re-encode existing keys so the whole file uses one mode.
    const current = { steam: this.decrypt(this.data.keys.steam), faceit: this.decrypt(this.data.keys.faceit) }
    const next = { ...current }
    if (keys.steam !== undefined) next.steam = keys.steam.trim() || undefined
    if (keys.faceit !== undefined) next.faceit = keys.faceit.trim() || undefined
    const encode = (v?: string): string | undefined =>
      v === undefined ? undefined : encrypt ? safeStorage.encryptString(v).toString('base64') : v
    this.data.keys = { steam: encode(next.steam), faceit: encode(next.faceit) }
    this.data.keysEncrypted = encrypt
    this.save()
    logger.info('config.keys_updated', { encrypted: encrypt })
  }

  keyStatus(): ApiKeyStatus {
    const steam = this.getKey('steam')
    const faceit = this.getKey('faceit')
    return { steam: !!steam.value, faceit: !!faceit.value, steamSource: steam.source, faceitSource: faceit.source }
  }
}
