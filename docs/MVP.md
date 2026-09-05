# CS2 Lobby Scout — MVP Specification

## 1. Overview

**CS2 Lobby Scout** is a lightweight Windows desktop application designed to help a CS2 player quickly inspect the public profile and performance statistics of all players in the current match, with special focus on the opposing team.

The application does **not** read CS2 process memory, inject DLLs, hook the game process, intercept private game data, automate aim/input, or expose hidden in-game information.

Its purpose is to aggregate legitimate public information from external services and present it in a compact scouting interface.

The MVP should answer three questions as quickly as possible:

1. **Who are the players in this match?**
2. **What do their public stats and account history look like?**
3. **Are there unusual statistical signals worth paying attention to?**

The application must never label a player as a cheater with certainty. It should only provide a transparent **Suspicion Score** based on public statistical signals.

---

## 2. MVP Goal

The first usable version should allow the user to:

1. Copy the output of the CS2 `status` command.
2. Paste it into CS2 Lobby Scout, or let the app detect the copied text from the clipboard.
3. Parse Steam IDs and player names.
4. Retrieve public Steam and FACEIT information.
5. Display all detected players in one view.
6. Identify the user's team and the opposing team when possible.
7. Show a simple statistical Suspicion Score.
8. Save players locally for future comparison.
9. Allow manually flagging interesting players for later review.
10. Check whether previously watched players later receive public bans.

---

## 3. Non-Goals

The MVP will **not**:

- Read `cs2.exe` memory.
- Inject DLLs.
- Hook DirectX or CS2 internals.
- Read enemy positions.
- Read enemy HP, weapons, inventory, or hidden information.
- Intercept packets to obtain unavailable game information.
- Automate keyboard or mouse input.
- Perform aim assistance.
- Perform wallhack/radar functionality.
- Claim that a player is definitively cheating.
- Attempt to bypass VAC or other anti-cheat systems.
- Depend on invasive game modification.

The project should remain an **external statistics and scouting application**.

---

## 4. MVP User Flow

### Step 1 — Start CS2 Lobby Scout

The user launches:

```text
CS2-Lobby-Scout.exe
```

The application remains open next to CS2 or on a second monitor.

---

### Step 2 — Get match players

Inside CS2:

```text
~
status
```

The user copies the console output.

For the first MVP, clipboard parsing is preferred over game automation because it is simple, transparent, and low risk.

Possible future versions may automate player detection through legitimate game integrations if enough information is available.

---

### Step 3 — Parse lobby

Lobby Scout extracts:

- Steam ID
- Player name
- Any other useful information exposed by `status`

Example internal structure:

```json
{
  "steamId": "76561198000000000",
  "name": "aim.exe"
}
```

---

### Step 4 — Enrich player information

For each detected player, the application queries available external sources.

Initial sources:

- Steam
- FACEIT
- Local CS2 Lobby Scout database

Future sources may be added separately.

---

### Step 5 — Display lobby

Example main screen:

```text
CS2 LOBBY SCOUT
─────────────────────────────────────────────────────────────────────

PLAYER          FACEIT    ELO     KD     HS%    MATCHES    BANS   SCORE
─────────────────────────────────────────────────────────────────────
DeadInside         8      1832   1.16    51%      1684       0      12
aim.exe            4      1180   1.82    74%        91       0      86
pepe               6      1450   1.09    44%       722       0      18
Nobody            10      2280   1.31    58%      2462       0      31
xXProXx            3      1032   1.67    72%        63       1      94
```

Suggested score bands:

```text
0–29      Low
30–49     Mild
50–69     Elevated
70–84     High
85–100    Very High
```

These labels indicate statistical anomaly only.

They must **not** be presented as proof of cheating.

---

# 5. Player Detail View

Clicking a player should open a detailed panel.

Example:

```text
aim.exe

Steam
──────────────────────────────
Steam ID:          76561198...
Account age:       5 months
CS2 hours:         214
VAC bans:          0
Game bans:         0

FACEIT
──────────────────────────────
Level:             4
ELO:               1180
Matches:           91

Performance
──────────────────────────────
KD:                1.82
ADR:               116
HS:                74%
Win rate:          68%

Scout
──────────────────────────────
Suspicion Score:   86 / 100

Signals
──────────────────────────────
+ High KD
+ High ADR
+ Very high HS%
+ Low match count
+ Young account
```

---

# 6. Core Features

## 6.1 Lobby Parser

The application must accept raw CS2 console output.

Responsibilities:

- Detect valid `status` output.
- Extract Steam IDs.
- Extract player names.
- Remove duplicate players.
- Ignore malformed lines.
- Handle partial lobby output.
- Detect the local player if possible.
- Store the original parsed text for debugging if debug mode is enabled.

---

## 6.2 Clipboard Detection

Optional automatic behavior:

1. User copies the CS2 `status` output.
2. Lobby Scout detects clipboard changes.
3. It recognizes a valid CS2 status block.
4. It asks to load the lobby or loads it automatically based on settings.

The MVP should also provide a manual:

```text
PASTE LOBBY
```

button.

---

## 6.3 Steam Integration

Retrieve public information such as:

- Steam display name
- Steam avatar
- Profile visibility
- VAC bans
- Game bans
- Days since last ban, when available
- Account creation date, when publicly obtainable
- Public game information, when available

The application should gracefully handle private Steam profiles.

Example:

```text
Steam Profile: PRIVATE
VAC Bans:      0
Game Bans:     0
```

Missing information must never automatically increase suspicion without a clearly defined rule.

---

## 6.4 FACEIT Integration

Retrieve available FACEIT data such as:

- FACEIT nickname
- FACEIT level
- FACEIT ELO
- Match count
- Win rate
- KD
- Headshot percentage
- Other public statistics exposed by the available API

The application should map Steam IDs to FACEIT accounts where possible.

If no FACEIT account is found:

```text
FACEIT: Not found
```

This must not itself be treated as suspicious.

---

## 6.5 Team Separation

Preferred UI:

```text
YOUR TEAM
────────────────────────
Player A
Player B
Player C
Player D
You

ENEMY TEAM
────────────────────────
Player F
Player G
Player H
Player I
Player J
```

If reliable team information is not available from the initial parsing method, the MVP may temporarily display:

```text
MATCH PLAYERS
```

with all detected players together.

Manual team assignment can be added if necessary.

Reliable automatic team detection is desirable but not a blocker for the first internal build.

---

# 7. Suspicion Engine v1

The first scoring engine should be intentionally simple and explainable.

No machine learning is required for MVP v1.

The objective is to detect **statistical anomalies**, not cheating.

Example scoring model:

```text
KD anomaly               0–25
ADR anomaly              0–20
HS anomaly               0–15
Account age              0–10
Low match count          0–10
Win-rate anomaly         0–10
Performance jump         0–10
─────────────────────────────
Maximum                  100
```

Example:

```text
KD 1.91                  +22
ADR 123                  +18
HS 78%                   +13
Account 3 months          +8
73 matches                +7
Win rate 72%              +7
Recent performance jump   +9
─────────────────────────────
TOTAL                     84
```

---

## 7.1 Important Scoring Rules

The engine must avoid simplistic logic.

Examples of bad logic:

```text
HS > 70% = cheater
KD > 1.5 = cheater
New account = cheater
```

These are not acceptable.

Instead, signals should be combined.

Example:

```text
High KD
+ High ADR
+ High HS%
+ Very low match count
+ Young account
```

is more interesting than any single metric.

---

## 7.2 Cohort Comparison

The long-term scoring system should compare players with similar skill levels.

For example:

```text
KD 1.40 at FACEIT Level 2
```

should not necessarily be treated the same way as:

```text
KD 1.40 at FACEIT Level 10
```

Future scoring should compare a player against a cohort based on:

- FACEIT level
- FACEIT ELO
- Match count
- Account history
- Possibly Premier rating if reliable data becomes available

MVP v1 can use fixed thresholds.

MVP v2 should move toward percentile-based cohort comparison.

---

# 8. Transparency

Every score must be explainable.

The UI must expose the signals contributing to the score.

Example:

```text
Suspicion Score: 82

WHY?

+18  KD unusually high
+16  ADR unusually high
+13  HS% unusually high
+10  Very low match count
+8   Young Steam account
+9   Recent statistical jump
+8   Unusual win rate
```

The application should never show only:

```text
82% CHEATER
```

Instead:

```text
Suspicion Score: 82 / 100
High statistical anomaly
```

---

# 9. Watch Player

Each player should have a:

```text
WATCH PLAYER
```

button.

Watching a player stores them locally for future review.

Stored information:

```text
Steam ID
Player name
First seen
Last seen
Games encountered
Suspicion score when seen
Public bans when seen
FACEIT stats when seen
```

---

# 10. Historical Ban Tracking

Lobby Scout should maintain a list of watched players.

Example:

```text
WATCHED PLAYERS

Player          Last Seen       Score     Ban
──────────────────────────────────────────────
aim.exe         2026-09-05       86       -
deadinside      2026-08-31       74       -
xXProXx         2026-08-28       91       GAME BAN
```

When a public ban appears later:

```text
GAME BAN DETECTED

Player:
xXProXx

First seen:
2026-08-28

Scout score:
91

Ban detected:
2026-09-18
```

This historical information can later be used to evaluate and recalibrate the scoring algorithm.

---

# 11. Local Player History

Every encounter should optionally be stored.

Example data:

```text
Player: aim.exe

Seen:
2026-08-10
2026-08-27
2026-09-05

Scout Scores:
72
79
86
```

This makes it possible to see whether a player's statistical profile is changing over time.

---

# 12. Local Database

Use SQLite.

Suggested tables:

## players

```sql
players
-------
steam_id
current_name
first_seen
last_seen
times_seen
watched
created_at
updated_at
```

## steam_snapshots

```sql
steam_snapshots
---------------
id
steam_id
profile_visibility
account_created_at
vac_bans
game_bans
days_since_last_ban
captured_at
```

## faceit_snapshots

```sql
faceit_snapshots
----------------
id
steam_id
faceit_id
nickname
level
elo
matches
kd
adr
headshot_percentage
win_rate
captured_at
```

## scout_scores

```sql
scout_scores
------------
id
steam_id
score
kd_score
adr_score
hs_score
account_age_score
match_count_score
win_rate_score
performance_jump_score
captured_at
```

## encounters

```sql
encounters
----------
id
match_session_id
steam_id
team
encountered_at
```

## match_sessions

```sql
match_sessions
--------------
id
created_at
source
raw_status_hash
```

---

# 13. Recommended Technology Stack

## Desktop application

```text
Electron
TypeScript
React
```

## Local backend

```text
Node.js
TypeScript
```

## Local persistence

```text
SQLite
```

Suggested libraries can be decided during implementation.

The initial priority is a simple architecture with as few moving parts as possible.

---

# 14. Proposed Application Architecture

```text
                  CS2
                   │
                   │ status
                   ▼
             Clipboard Input
                   │
                   ▼
           ┌─────────────────┐
           │  Lobby Parser   │
           └────────┬────────┘
                    │
                Steam IDs
                    │
        ┌───────────┼────────────┐
        │           │            │
        ▼           ▼            ▼
      Steam       FACEIT      Local DB
        │           │            │
        └───────────┼────────────┘
                    │
                    ▼
            Player Normalizer
                    │
                    ▼
            Suspicion Engine
                    │
                    ▼
           ┌─────────────────┐
           │    React UI     │
           └─────────────────┘
```

---

# 15. Internal Data Model

Normalized player representation:

```ts
interface ScoutPlayer {
  steamId: string;
  name: string;
  avatarUrl?: string;

  steam?: {
    profilePrivate?: boolean;
    accountCreatedAt?: string;
    vacBans?: number;
    gameBans?: number;
    daysSinceLastBan?: number;
  };

  faceit?: {
    playerId?: string;
    nickname?: string;
    level?: number;
    elo?: number;
    matches?: number;
    kd?: number;
    adr?: number;
    headshotPercentage?: number;
    winRate?: number;
  };

  scout: {
    score: number;
    level: "low" | "mild" | "elevated" | "high" | "very_high";
    signals: ScoutSignal[];
  };

  watched: boolean;
}
```

Signal representation:

```ts
interface ScoutSignal {
  type: string;
  label: string;
  points: number;
  explanation: string;
}
```

---

# 16. Error Handling

External services will fail occasionally.

The UI must tolerate partial data.

Examples:

```text
Steam      ✓
FACEIT     ✓
History    ✓
```

or:

```text
Steam      ✓
FACEIT     unavailable
History    ✓
```

A failed external request should not prevent the rest of the lobby from loading.

---

# 17. Caching

Avoid repeatedly requesting the same player data.

Suggested MVP cache policy:

```text
Steam profile          24 hours
Steam bans              6 hours
FACEIT profile          6 hours
FACEIT statistics       1 hour
```

A manual:

```text
REFRESH PLAYER
```

action can bypass the cache.

---

# 18. Rate Limiting

All external API requests must pass through a local request manager.

Responsibilities:

- Limit concurrency.
- Respect API limits.
- Cache successful responses.
- Retry temporary failures.
- Avoid duplicate requests.
- Back off after HTTP 429 responses.

---

# 19. Security

API keys should never be hardcoded into source code.

For development:

```text
.env
```

Example:

```text
STEAM_API_KEY=
FACEIT_API_KEY=
```

For packaged builds, credentials must be handled carefully.

If the project later becomes publicly distributed, APIs that require private secrets should ideally be accessed through a backend service rather than embedding permanent secrets in the desktop application.

---

# 20. Privacy

The MVP should only store information necessary for scouting.

Local database by default:

```text
%APPDATA%/CS2LobbyScout/
```

Possible structure:

```text
CS2LobbyScout/
├── scout.db
├── logs/
└── config.json
```

No cloud synchronization is required for MVP.

---

# 21. Logging

Development mode should support structured logs.

Example:

```text
2026-09-05 13:42:03 lobby.parse       players=10
2026-09-05 13:42:04 steam.lookup      players=10 success=10
2026-09-05 13:42:04 faceit.lookup     players=10 success=7 not_found=3
2026-09-05 13:42:05 score.calculate   players=10
```

Avoid logging API secrets.

---

# 22. UI Structure

## Main Lobby Screen

```text
┌─────────────────────────────────────────────────────────────┐
│ CS2 LOBBY SCOUT                            Paste Lobby      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ ENEMY TEAM                                                  │
│                                                             │
│ Player       Lvl    ELO    KD    HS    Games    Score       │
│ aim.exe       4    1180   1.82  74%     91       86        │
│ pepe          6    1450   1.09  44%    722       18        │
│ ...                                                         │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ YOUR TEAM                                                   │
│ ...                                                         │
└─────────────────────────────────────────────────────────────┘
```

---

## Player Panel

```text
┌─────────────────────────────────────┐
│ aim.exe                         [X] │
│                                     │
│ FACEIT 4 — 1180 ELO                 │
│ KD 1.82 / ADR 116 / HS 74%          │
│                                     │
│ Suspicion Score                     │
│ 86 / 100                            │
│                                     │
│ Signals                             │
│ + High KD                           │
│ + High ADR                          │
│ + Very high HS                      │
│ + Low match count                   │
│                                     │
│ [WATCH PLAYER]                      │
│ [STEAM PROFILE] [FACEIT PROFILE]    │
└─────────────────────────────────────┘
```

---

# 23. Configuration

Initial settings:

```text
General
-------
Auto-detect clipboard     ON/OFF
Auto-load detected lobby  ON/OFF
Save encounter history    ON/OFF

Display
-------
Always on top             ON/OFF
Compact mode              ON/OFF

Scouting
--------
Show suspicion score      ON/OFF
Show signal details       ON/OFF

Cache
-----
Clear cache
Clear history
```

---

# 24. MVP Development Milestones

## Milestone 0 — Project Bootstrap

Deliverables:

- Electron project
- React
- TypeScript
- Development build
- Packaging configuration
- Basic application shell

Done when:

```text
npm run dev
```

opens the desktop application.

---

## Milestone 1 — Lobby Parser

Deliverables:

- Paste text area
- CS2 `status` parser
- Steam ID extraction
- Player list

Done when a copied `status` block produces a stable normalized player list.

---

## Milestone 2 — Steam Integration

Deliverables:

- Steam profile lookup
- Avatar
- Ban data
- Profile visibility
- Steam caching

Done when all detected Steam IDs are enriched with available public Steam information.

---

## Milestone 3 — FACEIT Integration

Deliverables:

- Steam → FACEIT lookup
- FACEIT level
- ELO
- Matches
- KD
- HS%
- Win rate
- FACEIT caching

Done when available FACEIT information appears next to each player.

---

## Milestone 4 — Main Lobby UI

Deliverables:

- Lobby table
- Loading states
- Error states
- Player detail panel
- External profile links

Done when the user can inspect an entire lobby without leaving the main screen.

---

## Milestone 5 — SQLite History

Deliverables:

- SQLite database
- Player table
- Match sessions
- Encounters
- Steam snapshots
- FACEIT snapshots

Done when closing and reopening the app preserves previously encountered players.

---

## Milestone 6 — Suspicion Engine v1

Deliverables:

- Scoring module
- Fixed rules
- Score normalization
- Signal explanation
- Unit tests

Done when every player can receive a deterministic and fully explainable score.

---

## Milestone 7 — Watch Player

Deliverables:

- Watch/unwatch
- Watched players screen
- Historical scores
- Historical encounters

Done when players can be followed across multiple sessions.

---

## Milestone 8 — Ban Recheck

Deliverables:

- Refresh watched players
- Detect changed public ban status
- Store ban changes
- Surface notifications inside the app

Done when Lobby Scout can identify that a previously watched player's public ban state has changed.

---

# 25. MVP Definition of Done

Version `0.1.0` is considered usable when the following works end-to-end:

```text
✓ Launch Windows desktop app

✓ Copy CS2 status

✓ Paste/detect lobby

✓ Parse Steam IDs

✓ Show all detected players

✓ Retrieve Steam profiles

✓ Retrieve Steam ban information

✓ Retrieve FACEIT account information

✓ Show FACEIT Level

✓ Show FACEIT ELO

✓ Show basic performance statistics

✓ Persist players in SQLite

✓ Calculate Suspicion Score

✓ Explain Suspicion Score

✓ Watch player

✓ Reopen previously encountered player

✓ Recheck public bans

✓ Package application for Windows
```

---

# 26. Post-MVP Ideas

These are explicitly outside MVP scope.

## Statistical Improvements

- Percentile-based scoring
- FACEIT-level cohorts
- ELO cohorts
- Statistical z-scores
- Match-count weighting
- Confidence score
- Trend detection
- Performance-jump detection
- Historical anomaly detection

---

## Match Analysis

- Detect repeated opponents
- Match history
- Personal notes
- Manual suspicious-event markers
- Compare player before/after encounter
- Compare lobby strength

---

## Detection Calibration

Use historical ban outcomes to test the quality of the scoring model.

Example:

```text
HIGH SCORE PLAYERS

Tracked:             124
Later publicly banned: 37

LOW SCORE PLAYERS

Tracked:             862
Later publicly banned: 8
```

This should be used for calibration, not as proof that the model can definitively identify cheating.

---

## UI Improvements

- Overlay-like compact window
- Second-monitor mode
- Player cards
- Keyboard shortcuts
- Sort by score
- Sort by FACEIT ELO
- Filters
- Dark UI
- Mini mode
- Tray icon

---

## Possible Future Data Sources

Potential integrations can be evaluated individually based on API availability and terms:

- Additional public CS2 statistics providers
- Match history services
- Premier statistics
- Demo analysis
- Public ban databases

No future integration should require invasive access to the CS2 process.

---

# 27. Product Principles

CS2 Lobby Scout should follow five rules.

### 1. External

The application stays outside the CS2 process.

### 2. Public Data

Player evaluation is based on legitimate public or user-provided information.

### 3. Explainable

Every Suspicion Score must explain how it was calculated.

### 4. Probabilistic

The system identifies statistical anomalies, not confirmed cheating.

### 5. Historical

The real long-term value comes from tracking players over time and evaluating whether the scoring model correlates with later public outcomes.

---

# 28. Initial Repository Structure

Suggested structure:

```text
cs2-lobby-scout/
├── apps/
│   └── desktop/
│       ├── electron/
│       └── src/
│
├── packages/
│   ├── lobby-parser/
│   ├── steam-client/
│   ├── faceit-client/
│   ├── scout-engine/
│   ├── database/
│   └── shared/
│
├── docs/
│   └── MVP.md
│
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

For an even simpler first implementation, everything can initially live inside the desktop application and only be split into packages once the codebase grows.

---

# 29. Suggested First Implementation Order

Start with the narrowest possible vertical slice:

```text
1. Electron + React shell
2. Paste CS2 status
3. Parse one Steam ID
4. Parse complete lobby
5. Fetch Steam profile
6. Render player row
7. Add FACEIT lookup
8. Render full lobby
9. Add SQLite
10. Add scoring
11. Add Watch Player
12. Add ban recheck
13. Package Windows build
```

The first meaningful prototype should therefore be:

```text
CS2 status
    ↓
10 Steam IDs
    ↓
Steam + FACEIT
    ↓
10 player rows
```

Only after that pipeline is stable should the Suspicion Engine become a priority.

---

# 30. MVP Working Name

```text
CS2 Lobby Scout
```

Possible package/repository names:

```text
cs2-lobby-scout
CS2LobbyScout
lobby-scout
```

Recommended:

```text
cs2-lobby-scout
```
