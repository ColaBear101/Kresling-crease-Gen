const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  await page.goto('http://localhost:8894/index.html');
  await page.waitForTimeout(500);

  // Blur any input so keydown shortcuts are active (click blank area)
  await page.click('body');

  // Get baseline compress + history length isn't exposed, so test undo behavior instead
  const before = await page.$eval('#n-compress', el => el.value);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  const afterKey = await page.$eval('#n-compress', el => el.value);
  console.log('compress before:', before, 'after ArrowRight:', afterKey);

  // Now test undo: does it revert the keyboard-driven compress change?
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
  await page.waitForTimeout(150);
  const afterUndo = await page.$eval('#n-compress', el => el.value);
  console.log('compress after Ctrl+Z:', afterUndo, '(expected to revert to', before, 'if captured)');

  // Test energy graph redraw: capture canvas pixel hash before/after ArrowRight when material=polyimide
  await page.selectOption('#material', 'polyimide');
  await page.evaluate(() => document.querySelectorAll('#spEnergy').forEach(el => el.classList.remove('collapsed')));
  await page.waitForTimeout(300);
  const before2 = await page.$eval('#canvasEnergy', c => c.toDataURL());
  await page.click('body');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  const after2 = await page.$eval('#canvasEnergy', c => c.toDataURL());
  console.log('energy canvas changed after 3x ArrowRight (before drawEnergyDebounced fix expected NO except via other triggers)?', before2 !== after2);

  await browser.close();
})();
