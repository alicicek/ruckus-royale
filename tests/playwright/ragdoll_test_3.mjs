/**
 * Ragdoll Test 3 — Playwright browser automation for Ruckus Royale.
 *
 * Steps:
 *   1. Launch Chromium 1280x720
 *   2. Navigate to http://localhost:5173
 *   3. Wait 2s for page load
 *   4. Type "RagTest3" in #player-name
 *   5. Click #practice-btn
 *   6. Wait 5s for gameplay
 *   7. Screenshot → 01_idle.png
 *   8. Press W 1.5s
 *   9. Screenshot → 02_moving.png
 *  10. Release W, press A+W 1s
 *  11. Screenshot → 03_diagonal.png
 *  12. Release all, press Space, wait 0.5s
 *  13. Screenshot → 04_jump.png
 *  14. Evaluate render_game_to_text → state.json
 *  15. Collect console messages → console.txt
 *  16. Close
 */

import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUTPUT_DIR = resolve(
  "/Users/alicicek/Dev/test-game-dev-claude/output/web-game/claude-bench/ragdoll-test-3"
);
mkdirSync(OUTPUT_DIR, { recursive: true });

const URL = "http://localhost:5173";

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("[ragdoll_test_3] Launching Chromium...");

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

  // Collect ALL console messages
  const consoleMessages = [];
  page.on("console", (msg) => {
    const ts = new Date().toISOString();
    consoleMessages.push(`[${ts}] [${msg.type()}] ${msg.text()}`);
  });

  page.on("pageerror", (err) => {
    const ts = new Date().toISOString();
    consoleMessages.push(`[${ts}] [pageerror] ${err.message}`);
  });

  try {
    // Step 2 — Navigate
    console.log("[ragdoll_test_3] Navigating to", URL);
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 15000 });

    // Step 3 — Wait 2s for page / WASM init
    console.log("[ragdoll_test_3] Waiting 2s for page load...");
    await sleep(2000);

    // Step 4 — Type player name
    console.log("[ragdoll_test_3] Typing player name...");
    await page.fill("#player-name", "RagTest3");

    // Step 5 — Click Practice Room
    console.log("[ragdoll_test_3] Clicking #practice-btn...");
    await page.click("#practice-btn");

    // Step 6 — Wait 5s for gameplay to settle
    console.log("[ragdoll_test_3] Waiting 5s for gameplay...");
    await sleep(5000);

    // Step 7 — Screenshot idle
    console.log("[ragdoll_test_3] Taking screenshot 01_idle.png");
    await page.screenshot({
      path: resolve(OUTPUT_DIR, "01_idle.png"),
      fullPage: false,
    });

    // Step 8 — Press W for 1.5s (move forward)
    console.log("[ragdoll_test_3] Pressing W for 1.5s...");
    await page.keyboard.down("KeyW");
    await sleep(1500);

    // Step 9 — Screenshot moving
    console.log("[ragdoll_test_3] Taking screenshot 02_moving.png");
    await page.screenshot({
      path: resolve(OUTPUT_DIR, "02_moving.png"),
      fullPage: false,
    });

    // Step 10 — Release W, press A+W for 1s (diagonal)
    console.log("[ragdoll_test_3] Release W, press A+W for 1s...");
    await page.keyboard.up("KeyW");
    await page.keyboard.down("KeyA");
    await page.keyboard.down("KeyW");
    await sleep(1000);

    // Step 11 — Screenshot diagonal
    console.log("[ragdoll_test_3] Taking screenshot 03_diagonal.png");
    await page.screenshot({
      path: resolve(OUTPUT_DIR, "03_diagonal.png"),
      fullPage: false,
    });

    // Step 12 — Release all, press Space, wait 0.5s
    console.log("[ragdoll_test_3] Release all, press Space...");
    await page.keyboard.up("KeyA");
    await page.keyboard.up("KeyW");
    await page.keyboard.down("Space");
    await sleep(500);

    // Step 13 — Screenshot jump
    console.log("[ragdoll_test_3] Taking screenshot 04_jump.png");
    await page.screenshot({
      path: resolve(OUTPUT_DIR, "04_jump.png"),
      fullPage: false,
    });

    // Release Space
    await page.keyboard.up("Space");

    // Step 14 — Evaluate render_game_to_text
    console.log("[ragdoll_test_3] Evaluating render_game_to_text...");
    let stateJson = "{}";
    try {
      stateJson = await page.evaluate(() => {
        if (typeof window.render_game_to_text === "function") {
          return window.render_game_to_text();
        }
        return JSON.stringify({ error: "render_game_to_text not found" });
      });
    } catch (e) {
      stateJson = JSON.stringify({ error: e.message });
    }
    writeFileSync(resolve(OUTPUT_DIR, "state.json"), stateJson, "utf-8");
    console.log("[ragdoll_test_3] Saved state.json");

    // Step 15 — Console messages
    const consoleTxt = consoleMessages.join("\n");
    writeFileSync(resolve(OUTPUT_DIR, "console.txt"), consoleTxt, "utf-8");
    console.log(
      `[ragdoll_test_3] Saved console.txt (${consoleMessages.length} messages)`
    );
  } catch (err) {
    console.error("[ragdoll_test_3] ERROR:", err);

    // Still save whatever console messages we have
    const consoleTxt = consoleMessages.join("\n");
    writeFileSync(resolve(OUTPUT_DIR, "console.txt"), consoleTxt, "utf-8");

    // Try a crash screenshot
    try {
      await page.screenshot({
        path: resolve(OUTPUT_DIR, "crash.png"),
        fullPage: false,
      });
    } catch (_) {
      /* ignore */
    }
  } finally {
    // Step 16 — Close
    console.log("[ragdoll_test_3] Closing browser...");
    await browser.close();
    console.log("[ragdoll_test_3] Done.");
  }
}

main().catch((err) => {
  console.error("[ragdoll_test_3] Fatal:", err);
  process.exit(1);
});
