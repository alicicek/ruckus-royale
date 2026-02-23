/**
 * Ragdoll physics verification test for Ruckus Royale.
 *
 * Launches a browser, joins a Practice room, exercises movement keys,
 * captures screenshots and render_game_to_text() output, and logs
 * console messages.
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUTPUT_DIR = resolve(
  "/Users/alicicek/Dev/test-game-dev-claude/output/web-game/claude-bench/ragdoll-test-1"
);
mkdirSync(OUTPUT_DIR, { recursive: true });

const GAME_URL = "http://localhost:5173";
const consoleMessages = [];
const consoleErrors = [];

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("[ragdoll-test] Launching browser (headed with WebGL support)...");
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

  // Collect console messages
  page.on("console", (msg) => {
    const entry = `[${msg.type()}] ${msg.text()}`;
    consoleMessages.push(entry);
    if (msg.type() === "error" || msg.type() === "warning") {
      consoleErrors.push(entry);
    }
  });

  // Collect page errors
  page.on("pageerror", (err) => {
    const entry = `[PAGE_ERROR] ${err.message}`;
    consoleMessages.push(entry);
    consoleErrors.push(entry);
  });

  // ─── Step 1: Navigate and wait for load ───
  console.log(`[ragdoll-test] Navigating to ${GAME_URL}...`);
  try {
    await page.goto(GAME_URL, { waitUntil: "domcontentloaded", timeout: 15000 });
  } catch (err) {
    console.error(`[ragdoll-test] FATAL: Could not load ${GAME_URL}: ${err.message}`);
    await browser.close();
    process.exit(1);
  }
  await sleep(2000);
  console.log("[ragdoll-test] Page loaded, waiting for initial render...");

  // ─── Step 2: Fill player name ───
  console.log("[ragdoll-test] Setting player name to TestPlayer...");
  const nameInput = page.locator("#player-name");
  await nameInput.click({ clickCount: 3 }); // select all
  await nameInput.fill("TestPlayer");

  // ─── Step 3: Click Practice button ───
  console.log("[ragdoll-test] Clicking Practice button...");
  await page.click("#practice-btn");

  // ─── Step 4: Wait for room connection and game start ───
  console.log("[ragdoll-test] Waiting 4s for room connect and game start...");
  await sleep(4000);

  // ─── Step 5: Take first screenshot ───
  const screenshot1Path = resolve(OUTPUT_DIR, "01_after_join.png");
  await page.screenshot({ path: screenshot1Path, fullPage: false });
  console.log(`[ragdoll-test] Screenshot 1 saved: ${screenshot1Path}`);

  // ─── Step 6: Call render_game_to_text() ───
  let renderText1 = "UNAVAILABLE";
  try {
    renderText1 = await page.evaluate(() => {
      if (typeof window.render_game_to_text === "function") {
        return window.render_game_to_text();
      }
      return "render_game_to_text not found on window";
    });
  } catch (err) {
    renderText1 = `ERROR: ${err.message}`;
  }
  console.log("[ragdoll-test] render_game_to_text() #1:");
  console.log(renderText1);
  writeFileSync(
    resolve(OUTPUT_DIR, "render_text_1.json"),
    typeof renderText1 === "string" ? renderText1 : JSON.stringify(renderText1, null, 2)
  );

  // ─── Step 7: Press movement keys ───
  console.log("[ragdoll-test] Pressing movement keys (W, A, D, Space)...");

  // Focus the canvas for key events
  await page.click("#game-canvas");
  await sleep(200);

  // W (forward) for 1.5s
  await page.keyboard.down("KeyW");
  await sleep(1500);
  await page.keyboard.up("KeyW");

  // A (left) for 1s
  await page.keyboard.down("KeyA");
  await sleep(1000);
  await page.keyboard.up("KeyA");

  // D (right) for 1s
  await page.keyboard.down("KeyD");
  await sleep(1000);
  await page.keyboard.up("KeyD");

  // Space (jump)
  await page.keyboard.press("Space");
  await sleep(500);

  // W + D diagonal for 1s
  await page.keyboard.down("KeyW");
  await page.keyboard.down("KeyD");
  await sleep(1000);
  await page.keyboard.up("KeyW");
  await page.keyboard.up("KeyD");

  await sleep(500);

  // ─── Step 8: Take second screenshot ───
  const screenshot2Path = resolve(OUTPUT_DIR, "02_after_movement.png");
  await page.screenshot({ path: screenshot2Path, fullPage: false });
  console.log(`[ragdoll-test] Screenshot 2 saved: ${screenshot2Path}`);

  // ─── Step 9: Call render_game_to_text() again ───
  let renderText2 = "UNAVAILABLE";
  try {
    renderText2 = await page.evaluate(() => {
      if (typeof window.render_game_to_text === "function") {
        return window.render_game_to_text();
      }
      return "render_game_to_text not found on window";
    });
  } catch (err) {
    renderText2 = `ERROR: ${err.message}`;
  }
  console.log("[ragdoll-test] render_game_to_text() #2:");
  console.log(renderText2);
  writeFileSync(
    resolve(OUTPUT_DIR, "render_text_2.json"),
    typeof renderText2 === "string" ? renderText2 : JSON.stringify(renderText2, null, 2)
  );

  // ─── Step 10: Save console logs ───
  writeFileSync(
    resolve(OUTPUT_DIR, "console_all.txt"),
    consoleMessages.join("\n")
  );
  writeFileSync(
    resolve(OUTPUT_DIR, "console_errors.txt"),
    consoleErrors.join("\n")
  );

  console.log("\n[ragdoll-test] ═══ CONSOLE ERRORS ═══");
  if (consoleErrors.length === 0) {
    console.log("  (none)");
  } else {
    for (const err of consoleErrors) {
      console.log(`  ${err}`);
    }
  }

  console.log(`\n[ragdoll-test] ═══ SUMMARY ═══`);
  console.log(`  Total console messages: ${consoleMessages.length}`);
  console.log(`  Console errors/warnings: ${consoleErrors.length}`);
  console.log(`  Screenshots saved to: ${OUTPUT_DIR}`);
  console.log(`  Artifacts: 01_after_join.png, 02_after_movement.png, render_text_1.json, render_text_2.json, console_all.txt, console_errors.txt`);

  await browser.close();
  console.log("[ragdoll-test] Done.");
}

main().catch((err) => {
  console.error("[ragdoll-test] FATAL:", err);
  process.exit(1);
});
