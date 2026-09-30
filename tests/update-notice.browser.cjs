// Run with FTW_PLAYWRIGHT_MODULE pointing at an installed Playwright package.
const {chromium} = require(process.env.FTW_PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ headless:true, ...(process.env.FTW_CHROME ? { executablePath:process.env.FTW_CHROME } : {}) });
  try {
    const context = await browser.newContext({ viewport: {width:1000,height:800} });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    let version = {buildId:'B1',updating:false}, announcementId = 'a'.repeat(24), reads = new Set(), posts = [], failPost = false, failVersion = false, delayedA = null, delayA = false;
    await context.route('**/*', async route => {
      const u = new URL(route.request().url()), p = u.pathname;
      const uid = route.request().headers().authorization?.replace('Bearer ','') || 'A';
      if (p === '/api/version') {
        if (failVersion) return route.abort();
        return route.fulfill({json:version});
      }
      if (p === '/api/announcement') {
        const response = {userId:uid,announcement:{id:announcementId,title:'更新说明 '+uid,items:['<img src=x onerror=alert(1)>','按账号保存已读']},read:reads.has(uid)};
        if (delayA && uid === 'A') await new Promise(r => delayedA=r);
        return route.fulfill({json:response});
      }
      if (p === '/api/announcement/read') {
        const data=route.request().postDataJSON(); posts.push({uid,...data});
        if (failPost) return route.fulfill({status:503,json:{}});
        reads.add(uid);return route.fulfill({json:{ok:true}});
      }
      if (p === '/') return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"><script>window.__FTW_BUILD__="B1"</script><link rel="stylesheet" href="/update-notice.css"></head><body><input id="draft" value="未保存的报价"><div id="idleRefreshReminder" hidden></div><script src="/update-notice.js"></script></body></html>'});
      if (['/update-notice.js','/update-notice.css'].includes(p)) return route.fulfill({path:path.join(root,'public',p.slice(1)),contentType:p.endsWith('.js')?'text/javascript':'text/css'});
      return route.abort();
    });
    await page.goto('http://crm.test/');
    const wait = () => page.waitForTimeout(100);
    const poll = async () => { await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await wait(); };
    const login = async uid => { await page.evaluate(uid=>{localStorage.setItem('ftw_token',uid);window.__ftwNoticeUser={id:uid};document.dispatchEvent(new Event('ftw:session-change'));},uid);await wait(); };
    assert.equal(await page.locator('#updateNotice').isVisible(),false);
    await login('A');assert.match(await page.locator('#updateNotice').innerText(),/更新说明 A/);
    assert.equal(await page.locator('#updateNotice img').count(),0);
    failPost=true;await page.getByRole('button',{name:'知道了',exact:true}).click();await wait();
    assert.equal(await page.locator('#updateNotice').isVisible(),false);
    assert.equal(posts[0].userId,'A');
    await login('B');assert.match(await page.locator('#updateNotice').innerText(),/更新说明 B/);
    failPost=false;await page.getByRole('button',{name:'知道了',exact:true}).click();await wait();
    await login('A');assert.equal(await page.locator('#updateNotice').isVisible(),false);assert(reads.has('A'));
    // Old account response arrives after B has established its own session.
    reads.clear();announcementId='b'.repeat(24);delayA=true;await login('A');
    await login('B');delayedA();await wait();delayA=false;
    assert.match(await page.locator('#updateNotice').innerText(),/更新说明 B/);
    await page.getByRole('button',{name:'知道了',exact:true}).click();await wait();
    version={buildId:'B2',updating:false};await poll();assert.match(await page.locator('#updateNotice').innerText(),/新版本/);
    await page.getByRole('button',{name:'稍后',exact:true}).click();await poll();assert.equal(await page.locator('#updateNotice').isVisible(),false);
    await page.evaluate(()=>localStorage.setItem('ftw_update_snooze',JSON.stringify({buildId:'B2',until:Date.now()-1})));await poll();
    assert.equal(await page.locator('#updateNotice').isVisible(),true);
    await page.getByRole('button',{name:'稍后',exact:true}).click();
    const other=await context.newPage();await other.goto('http://crm.test/');await other.waitForTimeout(150);
    assert.equal(await other.locator('#updateNotice').isVisible(),false);await other.close();
    version={buildId:'B3',updating:false};await poll();assert.equal(await page.locator('#updateNotice').isVisible(),true);
    await page.getByRole('button',{name:'立即刷新',exact:true}).click();assert.equal(await page.locator('dialog').isVisible(),true);
    await page.getByRole('button',{name:'暂不刷新',exact:true}).click();assert.equal(await page.locator('#draft').inputValue(),'未保存的报价');
    version={buildId:'B4',updating:true};await poll();assert.match(await page.locator('#updateNotice').innerText(),/正在更新/);
    assert.equal(await page.getByRole('button',{name:'立即刷新',exact:true}).isVisible(),false);
    failVersion=true;await poll();assert.match(await page.locator('#updateNotice').innerText(),/正在更新/);
    failVersion=false;version={buildId:'B5',updating:false};await poll();
    await page.getByRole('button',{name:'立即刷新',exact:true}).click();
    version.updating=true;
    await page.getByRole('button',{name:'已保存，确认刷新',exact:true}).click();await wait();assert.equal(await page.locator('dialog').isVisible(),false);
    assert.equal(await page.locator('#draft').inputValue(),'未保存的报价');
    version.updating=false;await poll();
    await page.setViewportSize({width:390,height:844});
    const box=await page.locator('#updateNotice').boundingBox();assert(box.x>=0&&box.x+box.width<=390);
    if(process.env.FTW_SCREENSHOT_DIR) await page.screenshot({path:path.join(process.env.FTW_SCREENSHOT_DIR,'update-mobile.png')});
    await page.getByRole('button',{name:'立即刷新',exact:true}).click();
    await Promise.all([page.waitForEvent('load'),page.getByRole('button',{name:'已保存，确认刷新',exact:true}).click()]);
    assert.equal(errors.length,0,errors.join('\n'));
    console.log('PASS real browser: account isolation, stale response, failed read retry, XSS, version baseline, snooze, update priority, offline behavior, confirmation, mobile fit, explicit reload');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
