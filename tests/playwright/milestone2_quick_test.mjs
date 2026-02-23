/**
 * Milestone 2 Quick Test — capture combat screenshots early, before round ends.
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUTPUT_DIR = resolve(
  "/Users/alicicek/Dev/test-game-dev-claude/output/web-game/claude-bench/milestone2-quick-1"
);
mkdirSync(OUTPUT_DIR, { recursive: true });

const URL = "http://localhost:5173";

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("[m2q] Launching...");

  const browser = await chromium.launch({
    headless: false,
    args: [
      "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl",
      "--ignore-gpu-blocklist", "--enable-gpu-rasterization",
      "--enable-unsafe-swiftshader", "--disable-gpu-sandbox",
    ],
  });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();

  const consoleMessages = [];
  const errors = [];
  page.on("console", (msg) => {
    const entry = `[${msg.type()}] ${msg.text()}`;
    consoleMessages.push(entry);
    if (msg.type() === "error") errors.push(entry);
  });
  page.on("pageerror", (err) => {
    errors.push(`[pageerror] ${err.message}`);
    consoleMessages.push(`[pageerror] ${err.message}`);
  });

  try {
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 15000 });
    await sleep(2000);

    await page.fill("#player-name", "M2Quick");
    await page.click("#solo-btn");
    console.log("[m2q] Solo started, waiting 5s for combat start...");
    await sleep(5000);

    // Quick screenshot burst during active combat
    await page.screenshot({ path: resolve(OUTPUT_DIR, "01_combat_start.png") });

    let stateStr = await page.evaluate(() => window.render_game_to_text());
    let state = JSON.parse(stateStr);
    console.log(`[m2q] Players: ${state.players.length}, Phase: ${state.round.phase}, Survivors: ${state.round.survivors?.length}`);
    writeFileSync(resolve(OUTPUT_DIR, "state_01.json"), JSON.stringify(state, null, 2));

    // Move toward combat
    await page.keyboard.down("KeyW");
    await sleep(1000);
    await page.screenshot({ path: resolve(OUTPUT_DIR, "02_moving.png") });

    // Light attacks
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("KeyJ");
      await sleep(200);
    }
    await page.screenshot({ path: resolve(OUTPUT_DIR, "03_light_attack.png") });

    // Heavy attack
    await page.keyboard.press("KeyK");
    await sleep(400);
    await page.screenshot({ path: resolve(OUTPUT_DIR, "04_heavy_attack.png") });
    await page.keyboard.up("KeyW");

    // Brief wait for any knockouts
    await sleep(2000);
    await page.screenshot({ path: resolve(OUTPUT_DIR, "05_post_combat.png") });

    stateStr = await page.evaluate(() => window.render_game_to_text());
    state = JSON.parse(stateStr);
    console.log(`[m2q] Final: Players: ${state.players.length}, Phase: ${state.round.phase}, Survivors: ${state.round.survivors?.length}`);
    writeFileSync(resolve(OUTPUT_DIR, "state_final.json"), JSON.stringify(state, null, 2));

    // Get event feed
    const events = await page.evaluate(() => {
      const feed = document.getElementById("event-feed");
      return feed ? Array.from(feed.children).map(c => c.textContent) : [];
    });

    const summary = {
      playerCount: state.players.length,
      phase: state.round.phase,
      survivors: state.round.survivors?.length ?? 0,
      roundTimeLeft: state.round.roundTimeLeft,
      errorCount: errors.length,
      errors: errors.filter(e => !e.includes("404")),
      events,
    };
    writeFileSync(resolve(OUTPUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
    console.log("[m2q] Summary:", JSON.stringify(summary, null, 2));

  } catch (err) {
    console.error("[m2q] ERROR:", err);
    try { await page.screenshot({ path: resolve(OUTPUT_DIR, "crash.png") }); } catch (_) {}
  } finally {
    writeFileSync(resolve(OUTPUT_DIR, "console.txt"), consoleMessages.join("\n"));
    await browser.close();
    console.log("[m2q] Done.");
  }
}

main().catch(err => { console.error("[m2q] Fatal:", err); process.exit(1); });
