import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const OUT = '/Users/alicicek/Dev/test-game-dev-claude/output/web-game/claude-bench/solo-test-1';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const msgs = [];
  page.on('console', m => msgs.push(`[${m.type()}] ${m.text()}`));

  await page.goto('http://localhost:5173');
  await page.waitForTimeout(2000);

  await page.fill('#player-name', 'SoloTest');
  await page.click('#solo-btn');
  await page.waitForTimeout(8000);

  await page.screenshot({ path: `${OUT}/01_solo_start.png` });

  // Move forward
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2000);
  await page.keyboard.up('KeyW');
  await page.screenshot({ path: `${OUT}/02_moving.png` });

  // Attack
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('KeyJ');
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/03_combat.png` });

  // Wait for more bot action
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUT}/04_midgame.png` });

  const state = await page.evaluate(() => window.render_game_to_text());
  writeFileSync(`${OUT}/state.json`, typeof state === 'string' ? state : JSON.stringify(state, null, 2));
  writeFileSync(`${OUT}/console.txt`, msgs.join('\n'));

  await browser.close();
  console.log('Done. Artifacts in', OUT);
})();
