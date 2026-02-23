/**
 * Milestone 2 Hit/Knockout Test — verify hit reactions and knockout ragdoll collapse.
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUTPUT_DIR = resolve(
  "/Users/alicicek/Dev/test-game-dev-claude/output/web-game/claude-bench/milestone2-hit-1"
);
mkdirSync(OUTPUT_DIR, { recursive: true });

const URL = "http://localhost:5173";

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("[m2_hit] Launching Chromium...");

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

    // Start solo mode — bots will fight each other
    await page.fill("#player-name", "M2Hit");
    await page.click("#solo-btn");
    console.log("[m2_hit] Clicked solo, waiting for combat...");
    await sleep(8000);

    // Screenshot initial combat
    await page.screenshot({ path: resolve(OUTPUT_DIR, "01_initial.png") });

    // Move toward bots
    await page.keyboard.down("KeyW");
    await sleep(2000);
    await page.keyboard.up("KeyW");
    await page.screenshot({ path: resolve(OUTPUT_DIR, "02_approach.png") });

    // Light attacks — rapid
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("KeyJ");
      await sleep(350);
    }
    await sleep(500);
    await page.screenshot({ path: resolve(OUTPUT_DIR, "03_light_attacks.png") });

    // Heavy attacks — slower but harder
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("KeyK");
      await sleep(700);
    }
    await sleep(500);
    await page.screenshot({ path: resolve(OUTPUT_DIR, "04_heavy_attacks.png") });

    // Move and attack to chase bots
    await page.keyboard.down("KeyW");
    await page.keyboard.down("KeyD");
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("KeyJ");
      await sleep(300);
      await page.keyboard.press("KeyK");
      await sleep(500);
    }
    await page.keyboard.up("KeyW");
    await page.keyboard.up("KeyD");
    await sleep(500);
    await page.screenshot({ path: resolve(OUTPUT_DIR, "05_chase_combat.png") });

    // Wait for knockouts to happen
    await sleep(5000);
    await page.screenshot({ path: resolve(OUTPUT_DIR, "06_knockouts.png") });

    // More waiting for recovery
    await sleep(3000);
    await page.screenshot({ path: resolve(OUTPUT_DIR, "07_recovery.png") });

    // Long gameplay for more action
    await page.keyboard.down("KeyA");
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("KeyK");
      await sleep(400);
    }
    await page.keyboard.up("KeyA");
    await sleep(4000);
    await page.screenshot({ path: resolve(OUTPUT_DIR, "08_late_game.png") });

    // Get final state
    const stateStr = await page.evaluate(() => window.render_game_to_text());
    const state = JSON.parse(stateStr);
    writeFileSync(resolve(OUTPUT_DIR, "state_final.json"), JSON.stringify(state, null, 2));

    // Get event feed text
    const events = await page.evaluate(() => {
      const feed = document.getElementById("event-feed");
      if (!feed) return [];
      return Array.from(feed.children).map(c => c.textContent);
    });

    const summary = {
      playerCount: state.players.length,
      phase: state.round.phase,
      survivors: state.round.survivors?.length ?? "N/A",
      roundTimeLeft: state.round.roundTimeLeft,
      consoleErrorCount: errors.length,
      errors: errors.slice(0, 10),
      eventFeed: events,
    };
    writeFileSync(resolve(OUTPUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
    console.log("[m2_hit] Summary:", JSON.stringify(summary, null, 2));

  } catch (err) {
    console.error("[m2_hit] ERROR:", err);
    try {
      await page.screenshot({ path: resolve(OUTPUT_DIR, "crash.png") });
    } catch (_) {}
  } finally {
    writeFileSync(resolve(OUTPUT_DIR, "console.txt"), consoleMessages.join("\n"));
    await browser.close();
    console.log("[m2_hit] Done.");
  }
}

main().catch((err) => {
  console.error("[m2_hit] Fatal:", err);
  process.exit(1);
});
