/**
 * Milestone 3 Grab/Throw Test — verify grab joints and throw physics.
 * Bots grab each other, so we just observe and verify no errors.
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUTPUT_DIR = resolve(
  "/Users/alicicek/Dev/test-game-dev-claude/output/web-game/claude-bench/milestone3-grab-1"
);
mkdirSync(OUTPUT_DIR, { recursive: true });

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("[m3_grab] Launching...");

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
    await page.goto("http://localhost:5173", { waitUntil: "domcontentloaded", timeout: 15000 });
    await sleep(2000);

    await page.fill("#player-name", "M3Grab");
    await page.click("#solo-btn");
    console.log("[m3_grab] Solo started...");
    await sleep(5000);

    // Screenshot during early combat (bots will grab each other)
    await page.screenshot({ path: resolve(OUTPUT_DIR, "01_early.png") });
    let stateStr = await page.evaluate(() => window.render_game_to_text());
    let state = JSON.parse(stateStr);
    console.log(`[m3_grab] Phase: ${state.round.phase}, Players: ${state.players.length}`);

    // Grab events
    const events1 = await page.evaluate(() => {
      const feed = document.getElementById("event-feed");
      return feed ? Array.from(feed.children).map(c => c.textContent) : [];
    });
    console.log("[m3_grab] Events:", events1);

    // Move toward bots and try grabbing
    await page.keyboard.down("KeyW");
    await sleep(1500);
    // Press E to grab
    await page.keyboard.press("KeyE");
    await sleep(500);
    await page.screenshot({ path: resolve(OUTPUT_DIR, "02_grab_attempt.png") });

    // Hold grab while moving
    await sleep(1000);
    await page.screenshot({ path: resolve(OUTPUT_DIR, "03_holding.png") });
    await page.keyboard.up("KeyW");

    // Release grab (press E again)
    await page.keyboard.press("KeyE");
    await sleep(500);
    await page.screenshot({ path: resolve(OUTPUT_DIR, "04_release.png") });

    // Wait for more bot grabs/throws
    await sleep(3000);
    await page.screenshot({ path: resolve(OUTPUT_DIR, "05_bot_combat.png") });

    const events2 = await page.evaluate(() => {
      const feed = document.getElementById("event-feed");
      return feed ? Array.from(feed.children).map(c => c.textContent) : [];
    });

    stateStr = await page.evaluate(() => window.render_game_to_text());
    state = JSON.parse(stateStr);

    const summary = {
      playerCount: state.players.length,
      phase: state.round.phase,
      survivors: state.round.survivors?.length ?? 0,
      roundTimeLeft: state.round.roundTimeLeft,
      errorCount: errors.length,
      blockingErrors: errors.filter(e => !e.includes("404")),
      events: events2,
    };
    writeFileSync(resolve(OUTPUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
    writeFileSync(resolve(OUTPUT_DIR, "state.json"), JSON.stringify(state, null, 2));
    console.log("[m3_grab] Summary:", JSON.stringify(summary, null, 2));

  } catch (err) {
    console.error("[m3_grab] ERROR:", err);
    try { await page.screenshot({ path: resolve(OUTPUT_DIR, "crash.png") }); } catch (_) {}
  } finally {
    writeFileSync(resolve(OUTPUT_DIR, "console.txt"), consoleMessages.join("\n"));
    await browser.close();
    console.log("[m3_grab] Done.");
  }
}

main().catch(err => { console.error("[m3_grab] Fatal:", err); process.exit(1); });
