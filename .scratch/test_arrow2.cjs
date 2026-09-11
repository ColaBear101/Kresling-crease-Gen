const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  await page.goto('http://localhost:8894/index.html');
  await page.waitForTimeout(500);
  await page.click('body');
  // Start compress auto-animate via 'c' shortcut
  await page.keyboard.press('c');
  await page.waitForTimeout(600); // let it animate a bit
  const midVal = await page.$eval('#n-compress', el => el.value);
  // Press ArrowLeft - should stop the animation and set a definite value
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(50);
  const v1 = await page.$eval('#n-compress', el => el.value);
  await page.waitForTimeout(400); // if animation still running, value would keep changing
  const v2 = await page.$eval('#n-compress', el => el.value);
  console.log('mid-animation value:', midVal, ' right after ArrowLeft:', v1, ' 400ms later:', v2, '(should be stable/equal if animation stopped)');
  await browser.close();
})();
