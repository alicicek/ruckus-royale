import { spawn } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const cwd = process.cwd();
const codexHome = process.env.CODEX_HOME ?? `${process.env.HOME}/.codex`;
const webGameClient = process.env.WEB_GAME_CLIENT ?? `${codexHome}/skills/develop-web-game/scripts/web_game_playwright_client.js`;

if (!existsSync(webGameClient)) {
  console.error(`Playwright client script not found: ${webGameClient}`);
  process.exit(1);
}

const outputDir = resolve(cwd, "output/playwright");
mkdirSync(outputDir, { recursive: true });

const args = [
  webGameClient,
  "--url",
  process.env.GAME_URL ?? "http://localhost:5173",
  "--click-selector",
  process.env.GAME_CLICK_SELECTOR ?? "#solo-btn",
  "--actions-file",
  resolve(cwd, "tests/playwright/actions_brawl_smoke.json"),
  "--iterations",
  process.env.GAME_TEST_ITERATIONS ?? "4",
  "--pause-ms",
  process.env.GAME_TEST_PAUSE_MS ?? "420",
  "--screenshot-dir",
  outputDir,
];

const child = spawn("node", args, {
  cwd,
  stdio: "inherit",
  env: {
    ...process.env,
  },
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
