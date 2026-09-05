// Runs vitest with Electron's bundled Node so that better-sqlite3 (rebuilt for
// Electron's ABI by `electron-builder install-app-deps`) loads in tests.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const electron = require('electron')
const vitest = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs')
const args = process.argv.slice(2)

const child = spawn(electron, [vitest, ...(args.length ? args : ['run'])], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})
child.on('exit', (code) => process.exit(code ?? 1))
