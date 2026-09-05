# CS2 Lobby Scout

External scouting tool for Counter-Strike 2. Paste the output of the in-game `status` command and get a compact view of every player in the match: public Steam profile facts, FACEIT level / ELO / performance stats, an explainable **Suspicion Score**, and a local history of everyone you have played with.

The app never touches the game process. It reads no memory, injects nothing, hooks nothing and automates no input. It only aggregates public data from Steam and FACEIT and stores it locally. Scores measure *statistical anomaly*, never "cheating". See [`docs/MVP.md`](docs/MVP.md) for the full specification.

## Features (MVP 0.1.0)

- Parse CS2 (and legacy CS:GO) `status` output: Steam IDs, names, ping. Duplicates and bots are dropped.
- Clipboard detection: copy `status` in-game and the app offers to load it (or loads it automatically).
- Steam enrichment: name, avatar, profile visibility, account age, CS2 hours, VAC / game bans.
- FACEIT enrichment: level, ELO, matches, KD, ADR, HS%, win rate, plus recent-form averages.
- Suspicion Engine v1: fixed, explainable thresholds combined so that no single stat flags anyone. Every point is shown with its reason.
- Team assignment: mark players as your team / enemy; your own row is detected when your Steam ID is configured.
- Local SQLite history: players, encounters, Steam / FACEIT snapshots and scores across sessions.
- Watch players and recheck their public ban state later. New bans surface in-app together with the score you saw at the time.
- API cache with per-source TTLs, request de-duplication, concurrency limits and 429 back-off.

## Stack

Electron 38 · React 19 · TypeScript · Vite (electron-vite) · better-sqlite3 · Vitest.

```
src/
├── main/          Electron main process (IPC, config, SQLite, API clients, clipboard, ban recheck)
│   ├── db/        schema + repositories
│   └── services/  request-manager, steam-client, faceit-client, scout-service, ban-recheck
├── preload/       contextBridge API exposed to the renderer as window.scout
├── renderer/      React UI (lobby table, player panel, watched players, settings)
└── shared/        pure, testable modules: types, lobby-parser, scout-engine, steam-id
tests/             Vitest suites for parser, engine, DB, request manager and API clients
docs/MVP.md        product specification
```

## Getting started

Requirements: Node.js 22+ and npm. Windows is the target platform; development also works on macOS / Linux.

```bash
npm install
cp .env.example .env     # add your keys (see below)
npm run dev              # opens the desktop app with hot reload
```

`npm install` runs `electron-builder install-app-deps`, which rebuilds `better-sqlite3` for Electron's Node ABI. Prebuilt binaries are downloaded, so no compiler is needed on Windows in the normal case.

### API keys

| Key | Where to get it | Used for |
| --- | --- | --- |
| `STEAM_API_KEY` | https://steamcommunity.com/dev/apikey | profiles, bans, CS2 hours |
| `FACEIT_API_KEY` | https://developers.faceit.com/ (create an app, then a **server-side** Data API key) | FACEIT profile + stats |
| `MY_STEAM_ID` | your Steam64 ID (optional) | marks your row as "You" |

For development put them in `.env`. In a packaged build enter them in **Settings → API keys**. They are stored in the user data folder, encrypted with the OS keychain (`safeStorage`) when available. Nothing is ever hardcoded. The app works without keys, but only the parsed lobby and local history are shown.

### Usage

1. In CS2 open the console (`~`) and run `status`.
2. Select the output and copy it.
3. In CS2 Lobby Scout click **Paste lobby**, or accept the clipboard prompt.
4. Click a row for details, signals, history and the **Watch player** button.
5. **Watched** lists followed players and lets you **Recheck bans**. A recheck also runs at start-up and every 6 hours while the app is open (configurable).

Team information is not part of `status`, so use the per-row team button to mark enemies / teammates, or leave everything under *Match players*.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | dev build with hot reload |
| `npm run typecheck` | `tsc` for main/preload/shared and renderer |
| `npm test` | Vitest (runs under Electron's Node so SQLite loads) |
| `npm run build` | production bundle to `out/` |
| `npm run build:win` | NSIS installer in `release/` (run on Windows) |
| `npm run build:unpack` | unpacked build for the current OS in `release/` |

### Data location

Windows: `%APPDATA%\CS2LobbyScout\` (`scout.db`, `config.json`, `logs/`). Everything stays local. **Settings → Data** can clear the API cache or the whole history.

## Suspicion Engine v1

| Component | Max | Rule |
| --- | --- | --- |
| KD anomaly | 25 | ramps from KD 1.25 to 2.0 |
| ADR anomaly | 20 | ramps from 85 to 120 |
| HS% anomaly | 15 | ramps from 55% to 75% |
| Account age | 10 | < 3 / 6 / 12 / 24 months → 10 / 8 / 5 / 2. *Only counts alongside a performance anomaly* |
| Low match count | 10 | < 50 / 100 / 200 matches → 10 / 7 / 4. *Only counts alongside a performance anomaly* |
| Win rate | 10 | ramps from 58% to 75%, halved under 20 matches |
| Performance jump | 10 | recent 20 matches vs lifetime KD / ADR, needs ≥ 100 lifetime matches |

Bands: 0–29 Low · 30–49 Mild · 50–69 Elevated · 70–84 High · 85–100 Very High. Missing data (private profile, no FACEIT account) never adds points. Existing bans are shown as facts and are not scored. Thresholds live in `src/shared/scout-engine.ts`; v2 will move to FACEIT-level cohorts and percentiles.
