# Ruckus Royale

Browser-native party brawler prototype inspired by the feel of physics party games, built as a monorepo with authoritative multiplayer simulation.

## Stack

- `apps/client`: Vite + Three.js + Rapier visual wobble + Howler audio
- `apps/server`: Colyseus authoritative game server
- `packages/shared`: Shared network contracts, constants, and deterministic motion helpers
- `tests/playwright`: Browser automation smoke scenarios

## Features in this implementation

- Private lobby room-code flow (`brawl_room`)
- Solo quick match with server-side bot fill (1 human + 7 bots)
- Core loop: best-of-5 rounds, 90s rounds, sudden death hazard ramp at 60s
- Combat actions: move, jump, sprint, grab/release, light/heavy attacks, emote
- Knockout triggers: ring-out, hazard impact, stun-overload
- Three launch arenas with hazards:
  - Cargo Rooftop (moving crates + edge drops)
  - Ferry Deck (sweeper + slippery motion profile)
  - Factory Pit (conveyors + press hazards)
- Client local prediction + server reconciliation
- Remote interpolation buffer targeting ~100ms delay
- Browser test hooks:
  - `window.render_game_to_text()`
  - `window.advanceTime(ms)`

## Run

```bash
npm install
npm run dev
```

- Client: `http://localhost:5173`
- Server: `http://localhost:2567`

## Build and Typecheck

```bash
npm run typecheck
npm run build
```

## Playwright Smoke Automation

The smoke runner uses the required skill script (`web_game_playwright_client.js`) and writes screenshots/state artifacts.

```bash
npm run test:playwright
```

Artifacts:

- `/Users/alicicek/Dev/test-game-dev/output/playwright/shot-*.png`
- `/Users/alicicek/Dev/test-game-dev/output/playwright/state-*.json`

## Controls

- Move: `WASD` / left stick
- Jump: `Space` / gamepad `A`
- Grab/Release: `E` / gamepad `RB`
- Light attack: `J` / left mouse / gamepad `X`
- Heavy attack: `K` / right mouse / gamepad `B`
- Sprint: `Shift` / gamepad `RT`
- Emote: `C` / gamepad `Y`
- Fullscreen toggle: `F` (`Esc` exits fullscreen)
