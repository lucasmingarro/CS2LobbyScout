import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

const shared = { '@shared': resolve('src/shared') }

/**
 * Strict Content-Security-Policy for production builds only. In development
 * Vite's HMR client and the React refresh preamble need inline scripts and a
 * websocket, so the policy is omitted there.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://*.steamstatic.com https://*.faceit.com https://*.faceit-cdn.net",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'"
].join('; ')

function cspPlugin(): Plugin {
  let isBuild = false
  return {
    name: 'scout-csp',
    configResolved(config) {
      isBuild = config.command === 'build'
    },
    transformIndexHtml(html) {
      if (!isBuild) return html
      return html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared }
  },
  renderer: {
    plugins: [react(), cspPlugin()],
    resolve: {
      alias: { ...shared, '@renderer': resolve('src/renderer/src') }
    }
  }
})
