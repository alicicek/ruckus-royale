/**
 * Milestone 1 Solo Test — verify 8 players, camera zoom, hit reactions, no errors.
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUTPUT_DIR = resolve(
  "/Users/alicicek/Dev/test-game-dev-claude/output/web-game/claude-bench/milestone1-solo-1"
);
mkdirSync(OUTPUT_DIR, { recursive: true });

const URL = "http://localhost:5173";

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("[m1_solo] Launching Chromium...");

  const browser = await chromium.launch({
    headless: false,
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--enable-gpu-rasterization",
      "--enable-unsafe-swiftshader",
      "--disable-gpu-sandbox",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  const consoleMessages = [];
  const errors = [];
  page.on("console", (msg) => {
    const ts = new Date().toISOString();
    const entry = `[${ts}] [${msg.type()}] ${msg.text()}`;
    consoleMessages.push(entry);
    if (msg.type() === "error") errors.push(entry);
  });
  page.on("pageerror", (err) => {
    const ts = new Date().toISOString();
    const entry = `[${ts}] [pageerror] ${err.message}`;
    consoleMessages.push(entry);
    errors.push(entry);
  });

  try {
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 15000 });
    await sleep(2000);

    // Start solo mode
    await page.fill("#player-name", "M1Solo");
    await page.click("#solo-btn");
    console.log("[m1_solo] Clicked solo, waiting for round...");
    await sleep(8000);

    // Screenshot 1: Solo start with bots
    await page.screenshot({ path: resolve(OUTPUT_DIR, "01_solo_start.png") });

    // Get initial state to check player count
    let stateStr = await page.evaluate(() => window.render_game_to_text());
    let state = JSON.parse(stateStr);
    console.log(`[m1_solo] Players: ${state.players.length}, Phase: ${state.round.phase}`);
    writeFileSync(resolve(OUTPUT_DIR, "state_initial.json"), JSON.stringify(state, null, 2));

    // Move around
    await page.keyboard.down("KeyW");
    await sleep(1500);
    await page.screenshot({ path: resolve(OUTPUT_DIR, "02_moving.png") });
    await page.keyboard.up("KeyW");

    // Strafe and attack
    await page.keyboard.down("KeyD");
    await sleep(500);
    await page.keyboard.press("KeyJ");
    await sleep(300);
    await page.keyboard.press("KeyJ");
    await sleep(300);
    await page.keyboard.press("KeyJ");
    await page.keyboard.up("KeyD");
    await sleep(500);
    await page.screenshot({ path: resolve(OUTPUT_DIR, "03_combat.png") });

    // Heavy attacks
    await page.keyboard.press("KeyK");
    await sleep(500);
    await page.keyboard.press("KeyK");
    await sleep(500);
    await page.screenshot({ path: resolve(OUTPUT_DIR, "04_heavy_attacks.png") });

    // Jump
    await page.keyboard.down("Space");
    await sleep(200);
    await page.keyboard.up("Space");
    await sleep(800);
    await page.screenshot({ path: resolve(OUTPUT_DIR, "05_jump.png") });

    // Wait for more action
    await page.waitForTimeout(5000);
    await page.screenshot({ path: resolve(OUTPUT_DIR, "06_midgame.png") });

    // More combat
    await page.keyboard.down("KeyW");
    await page.keyboard.press("KeyJ");
    await sleep(200);
    await page.keyboard.press("KeyJ");
    await sleep(200);
    await page.keyboard.press("KeyK");
    await sleep(200);
    await page.keyboard.up("KeyW");
    await page.waitForTimeout(3000);
    await page.screenshot({ path: resolve(OUTPUT_DIR, "07_late_game.png") });

    // Final state
    stateStr = await page.evaluate(() => window.render_game_to_text());
    state = JSON.parse(stateStr);
    console.log(`[m1_solo] Final players: ${state.players.length}, Phase: ${state.round.phase}`);
    writeFileSync(resolve(OUTPUT_DIR, "state_final.json"), JSON.stringify(state, null, 2));

    // Summary
    const summary = {
      playerCount: state.players.length,
      phase: state.round.phase,
      arena: state.round.arena,
      mode: state.mode,
      survivors: state.round.survivors?.length ?? "N/A",
      roundTimeLeft: state.round.roundTimeLeft,
      consoleErrorCount: errors.length,
      errors: errors.slice(0, 10),
    };
    writeFileSync(resolve(OUTPUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
    console.log("[m1_solo] Summary:", JSON.stringify(summary, null, 2));

  } catch (err) {
    console.error("[m1_solo] ERROR:", err);
    try {
      await page.screenshot({ path: resolve(OUTPUT_DIR, "crash.png") });
    } catch (_) {}
  } finally {
    writeFileSync(resolve(OUTPUT_DIR, "console.txt"), consoleMessages.join("\n"));
    await browser.close();
    console.log("[m1_solo] Done.");
  }
}

main().catch((err) => {
  console.error("[m1_solo] Fatal:", err);
  process.exit(1);
});
