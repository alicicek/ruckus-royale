/**
 * Ragdoll physics test #2 for Ruckus Royale.
 *
 * 1.  Launch chromium 1280x720
 * 2.  Navigate to http://localhost:5173
 * 3.  Wait 2s for load
 * 4.  Type "TestPlayer2" into #player-name
 * 5.  Click #practice-btn
 * 6.  Wait 5s for connection + gameplay start
 * 7.  Screenshot → 01_idle.png
 * 8.  Hold W for 2s (keydown, wait, keyup)
 * 9.  Screenshot → 02_forward.png
 * 10. Press Space (jump)
 * 11. Wait 1s
 * 12. Screenshot → 03_jump.png
 * 13. render_game_to_text() → state.json
 * 14. Console messages → console.txt
 * 15. Close browser
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUTPUT_DIR = resolve(
  "/Users/alicicek/Dev/test-game-dev-claude/output/web-game/claude-bench/ragdoll-test-2"
);
mkdirSync(OUTPUT_DIR, { recursive: true });

const GAME_URL = "http://localhost:5173";
const consoleMessages = [];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  // ─── 1. Launch chromium 1280x720 ───
  console.log("[ragdoll-test-2] Launching chromium (headed, 1280x720)...");
  const browser = await chromium.launch({
    headless: false,
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--disable-gpu-sandbox",
      "--enable-unsafe-swiftshader",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  // Collect every console message
  page.on("console", (msg) => {
    consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    consoleMessages.push(`[PAGE_ERROR] ${err.message}`);
  });

  // ─── 2. Navigate to localhost:5173 ───
  console.log(`[ragdoll-test-2] Navigating to ${GAME_URL}...`);
  try {
    await page.goto(GAME_URL, { waitUntil: "domcontentloaded", timeout: 15000 });
  } catch (err) {
    console.error(`[ragdoll-test-2] FATAL: Could not load ${GAME_URL}: ${err.message}`);
    await browser.close();
    process.exit(1);
  }

  // ─── 3. Wait 2s for load ───
  await sleep(2000);
  console.log("[ragdoll-test-2] Page loaded.");

  // ─── 4. Type "TestPlayer2" into #player-name ───
  console.log("[ragdoll-test-2] Entering player name 'TestPlayer2'...");
  const nameInput = page.locator("#player-name");
  await nameInput.click({ clickCount: 3 }); // select all existing text
  await nameInput.fill("TestPlayer2");

  // ─── 5. Click #practice-btn ───
  console.log("[ragdoll-test-2] Clicking Practice button...");
  await page.click("#practice-btn");

  // ─── 6. Wait 5s for connection + gameplay start ───
  console.log("[ragdoll-test-2] Waiting 5s for connection and gameplay start...");
  await sleep(5000);

  // ─── 7. Screenshot → 01_idle.png ───
  const shot1 = resolve(OUTPUT_DIR, "01_idle.png");
  await page.screenshot({ path: shot1, fullPage: false });
  console.log(`[ragdoll-test-2] Screenshot saved: ${shot1}`);

  // Focus canvas so key events reach the game
  await page.click("#game-canvas");
  await sleep(200);

  // ─── 8. Press W key for 2 seconds (keydown, wait, keyup) ───
  console.log("[ragdoll-test-2] Pressing W (forward) for 2 seconds...");
  await page.keyboard.down("KeyW");
  await sleep(2000);
  await page.keyboard.up("KeyW");
  await sleep(300); // brief settle

  // ─── 9. Screenshot → 02_forward.png ───
  const shot2 = resolve(OUTPUT_DIR, "02_forward.png");
  await page.screenshot({ path: shot2, fullPage: false });
  console.log(`[ragdoll-test-2] Screenshot saved: ${shot2}`);

  // ─── 10. Press Space for jump ───
  console.log("[ragdoll-test-2] Pressing Space (jump)...");
  await page.keyboard.press("Space");

  // ─── 11. Wait 1 second ───
  await sleep(1000);

  // ─── 12. Screenshot → 03_jump.png ───
  const shot3 = resolve(OUTPUT_DIR, "03_jump.png");
  await page.screenshot({ path: shot3, fullPage: false });
  console.log(`[ragdoll-test-2] Screenshot saved: ${shot3}`);

  // ─── 13. render_game_to_text() → state.json ───
  console.log("[ragdoll-test-2] Calling render_game_to_text()...");
  let stateJson = "UNAVAILABLE";
  try {
    stateJson = await page.evaluate(() => {
      if (typeof window.render_game_to_text === "function") {
        return window.render_game_to_text();
      }
      return "render_game_to_text not found on window";
    });
  } catch (err) {
    stateJson = `ERROR: ${err.message}`;
  }
  writeFileSync(
    resolve(OUTPUT_DIR, "state.json"),
    typeof stateJson === "string" ? stateJson : JSON.stringify(stateJson, null, 2)
  );
  console.log("[ragdoll-test-2] state.json saved.");

  // ─── 14. Console messages → console.txt ───
  writeFileSync(resolve(OUTPUT_DIR, "console.txt"), consoleMessages.join("\n"));
  console.log(`[ragdoll-test-2] console.txt saved (${consoleMessages.length} messages).`);

  // ─── 15. Close browser ───
  await browser.close();
  console.log("[ragdoll-test-2] Browser closed. Done.");
}

main().catch((err) => {
  console.error("[ragdoll-test-2] FATAL:", err);
  process.exit(1);
});
