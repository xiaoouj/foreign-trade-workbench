const { chromium } = require(process.env.FTW_PLAYWRIGHT_MODULE || 'playwright');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

(async () => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'crm-calc-'));
  const password = crypto.randomUUID();
  const port = 4198;
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, FTW_DATA_DIR: data, FTW_STORAGE: 'json', FTW_ADMIN_PASSWORD: password, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (part) => { serverLog += part; });
  server.stderr.on('data', (part) => { serverLog += part; });
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 1200; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) { ready = true; break; } } catch {}
      if (server.exitCode !== null) throw Error(serverLog);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw Error('Server did not start: ' + serverLog);
    browser = await chromium.launch({ headless: true, ...(process.env.FTW_CHROME ? { executablePath: process.env.FTW_CHROME } : {}) });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/#/calc`);
    await page.locator('#loginUser').fill('admin');
    await page.locator('#loginPwd').fill(password);
    await page.locator('#loginForm button[type=submit]').click();
    await page.locator('#view-calc.active').waitFor();
    const notice = page.locator('#updateNotice');
    if (await notice.isVisible()) await page.getByRole('button', { name: '知道了', exact: true }).click();

    assert.equal(await page.locator('[data-view=tools]').count(), 0);
    await page.locator('[data-k="7"]').click();
    await page.locator('[data-k="+"]').click();
    await page.locator('[data-k="8"]').click();
    await page.locator('[data-k="="]').click();
    assert.equal(await page.locator('#calcDisplay').inputValue(), '15');
    assert.equal(await page.locator('.calc-history-item').count(), 1);
    if (process.env.FTW_SCREENSHOT_DIR) {
      await fs.mkdir(process.env.FTW_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.FTW_SCREENSHOT_DIR, 'calc-normal.png') });
    }
    await page.keyboard.type('12+3');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#calcDisplay').inputValue(), '15');
    await page.locator('[data-k="C"]').click();
    await page.keyboard.type('8-3');
    await page.locator('[data-k="±"]').click();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#calcDisplay').inputValue(), '11');
    await page.locator('[data-k="C"]').click();
    await page.keyboard.type('200+10');
    await page.locator('[data-k="%"]').click();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#calcDisplay').inputValue(), '220');
    await page.locator('[data-k="C"]').click();
    await page.keyboard.type('7+8*2');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#calcDisplay').inputValue(), '23');
    await page.locator('[data-k="C"]').click();
    await page.keyboard.type('5/0');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#calcDisplay').inputValue(), '5÷0');

    await page.locator('[data-calctab=cbm]').click();
    assert.equal(await page.locator('#view-calc [data-calctab].active').getAttribute('data-calctab'), 'cbm');
    for (const [id, value] of Object.entries({ cbmL: '120', cbmW: '100', cbmH: '90', cbmQty: '10' })) await page.locator('#' + id).fill(value);
    assert.match(await page.locator('#cbmResult').innerText(), /10\.8/);
    if (process.env.FTW_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.FTW_SCREENSHOT_DIR, 'calc-cbm.png') });
    await page.locator('#cbmToContainer').click();
    assert.equal(await page.locator('#view-calc [data-calctab].active').getAttribute('data-calctab'), 'container');
    assert.equal(await page.locator('#ctCBM').inputValue(), '10.8');
    assert.match(await page.locator('#ctResult').innerText(), /在规划容量内/);
    await page.locator('#ctMode').selectOption('carton');
    for (const [id, value] of Object.entries({ ctcL: '60', ctcW: '50', ctcH: '40', ctcN: '200' })) await page.locator('#' + id).fill(value);
    assert.match(await page.locator('#ctResult').innerText(), /整齐排放上限/);
    if (process.env.FTW_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.FTW_SCREENSHOT_DIR, 'calc-container.png') });
    await page.locator('#ctL').fill('1');
    assert.equal(await page.locator('#ctType').inputValue(), 'custom');
    await page.setViewportSize({ width: 390, height: 844 });
    const panel = await page.locator('#calc-container .calc-card').first().boundingBox();
    assert(panel && panel.x >= 0 && panel.x + panel.width <= 391, JSON.stringify(panel));
    if (process.env.FTW_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.FTW_SCREENSHOT_DIR, 'calc-mobile.png') });
    const oldEndpoints = await page.evaluate(async () => [
      (await api('/api/hs')).status,
      (await api('/api/dedup/preview')).status,
    ]);
    assert.deepEqual(oldEndpoints, [404, 404]);
    await page.evaluate(() => { location.hash = '/tools'; });
    await page.locator('#view-dashboard.active').waitFor();
    assert.equal(new URL(page.url()).hash, '#/dashboard');
    assert.deepEqual(errors, []);
    console.log('PASS calculator keyboard, sign, history, CBM transfer, carton estimate, removed tools, mobile layout');
  } finally {
    if (browser) await browser.close();
    if (server.exitCode === null) { server.kill('SIGTERM'); await once(server, 'exit'); }
    await fs.rm(data, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
