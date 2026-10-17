// Optional UI regression: npm install --no-save playwright; npx playwright install chromium
// Serve the project on 127.0.0.1:8765, then run node tests/test_embedded_sections.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const out = process.env.QUARK_UI_TEST_OUTPUT || require('node:path').join(require('node:os').tmpdir(), 'quark-test-output');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const report = [];
  try {
    for (const viewport of [{ width:1440, height:1000 }, { width:390, height:844 }]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      // Do not call Google Fonts or any model/provider while testing local UI.
      await page.route(/https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
      await page.goto(process.env.QUARK_UI_TEST_URL || 'http://127.0.0.1:8765');
      await page.locator('#gName').fill('مستخدم الاختبار');
      await page.locator('#gGo').click();
      await page.waitForFunction(() => document.getElementById('gate').hidden);
      await page.waitForTimeout(300);
      assert.deepEqual(errors, [], 'startup errors');
      await page.evaluate(() => {
        chats.unshift({ id:'integration-test-chat', title:'محادثة اختبار', ts:Date.now(), messages:[
          { role:'user', content:'أريد تنظيم أعمالي.' },
          { role:'assistant', content:'يمكنك إدارة المهام من اللوحة مع بقاء المحادثة هنا.' }
        ] });
        currentId = 'integration-test-chat'; save(); renderAll();
      });
      await page.waitForTimeout(50);
      const ids = await page.evaluate(() => {
        const ids = [...document.querySelectorAll('[id]:not(symbol)')].map(n => n.id);
        return ids.filter((id, i) => ids.indexOf(id) !== i);
      });
      assert.deepEqual(ids, [], 'duplicate IDs');
      assert.equal(await page.locator('#navMemory,#navSkills,#navTasks').count(), 0);

      // Tasks are a panel, not a route or a replacement for the composer.
      const input = page.locator('#input');
      const inputId = await page.evaluate(() => el.input.id);
      const composer = page.locator('#' + inputId);
      await composer.fill('مسودة يجب الاحتفاظ بها');
      const hash = await page.evaluate(() => location.hash);
      // Tasks live in ONE place: Library > Tasks, with three inner sections (list / results / activity).
      assert.equal(await page.locator('#topTasks').count(), 0);
      assert.equal(await page.locator('#lbTabs [data-tab="results"]').count(), 0, 'no separate results tab');
      assert.equal(await page.locator('#tabs [data-tab="tasks"]').count(), 0, 'no tasks tab in settings');
      await page.evaluate(() => { location.hash = '#/library/tasks'; });
      await page.waitForFunction(() => location.hash === '#/library/tasks');
      assert.equal(await page.locator('#tkTasksView').isVisible(), true);
      assert.equal(await page.locator('#tkList').isVisible(), true);
      assert.equal(await page.locator('#lbAdd').isVisible(), true);
      await page.locator('#tkSeg [data-sub="results"]').click();
      await page.waitForFunction(() => location.hash === '#/library/tasks/results');
      assert.equal(await page.locator('#tkResList').isVisible(), true);
      assert.equal(await page.locator('#tkList').isVisible(), false);
      assert.equal(await page.locator('#lbAdd').isVisible(), false);
      assert.equal(await page.locator('#lbMulti').isVisible(), false);
      await page.locator('#tkSeg [data-sub="act"]').click();
      await page.waitForFunction(() => location.hash === '#/library/tasks/act');
      assert.equal(await page.locator('#tkActList').isVisible(), true);
      assert.equal(await page.locator('#tkPauseAll').count(), 1);
      await page.locator('#tkSeg [data-sub="list"]').click();
      await page.waitForFunction(() => location.hash === '#/library/tasks');
      // Legacy links land in the same place.
      await page.evaluate(() => showChatView()); await page.waitForTimeout(100);
      await page.evaluate(() => { location.hash = '#/library/results'; });
      await page.waitForFunction(() => location.hash === '#/library/tasks/results');
      await page.evaluate(() => showChatView()); await page.waitForTimeout(100);
      await page.evaluate(() => { location.hash = '#/settings/tasks'; });
      await page.waitForFunction(() => location.hash === '#/library/tasks/act');
      assert.equal(await page.locator('#tkActList').isVisible(), true);
      await page.evaluate(() => { window.__tkSetSub('list'); });
      await page.evaluate(() => { showChatView(); window.__syncHash(); });
      assert.equal(await composer.inputValue(), 'مسودة يجب الاحتفاظ بها');

      // Old memory link resolves to the embedded personalization section.
      await page.evaluate(() => { location.hash = '#/memory'; });
      await page.waitForFunction(() => location.hash === '#/settings/custom');
      assert.equal(await page.locator('#memoryMount > #mmView').count(), 1);
      assert.equal(await page.locator('#memoryDetails').getAttribute('open') !== null, true);
      await page.locator('#mmAddDetails > summary').click();
      await page.locator('#mmNew').fill('أفضل الاختبارات المحلية');
      await page.locator('#mmAddBtn').click();
      await page.locator('#mmList .mm-card').filter({ hasText:'أفضل الاختبارات المحلية' }).waitFor();
      await page.locator('#mmSearch').fill('غير موجود');
      assert.equal(await page.locator('#mmList .mm-card').count(), 0);
      await page.locator('#mmSearch').fill('');
      await page.screenshot({ path:`${out}/memory-${viewport.width}.png`, fullPage:true });

      // Embedded skills tab and global skill settings.
      await page.evaluate(() => { location.hash = '#/skills'; });
      await page.waitForFunction(() => location.hash === '#/library/skills');
      assert.equal(await page.locator('#skillsMount > #skView').isVisible(), true);
      assert.equal(await page.locator('#lbGrid').isVisible(), false);
      assert.equal(await page.locator('#lbAdd').isVisible(), true);
      assert.equal(await page.locator('#lbSearchBtn').isVisible(), true);
      assert.equal(await page.locator('#lbSortBtn').isVisible(), true);
      assert.equal(await page.locator('#skList .sk-card').count() > 0, true);
      await page.locator('#lbSearchBtn').click();
      await page.locator('#lbQ').fill('غير موجود بالتأكيد');
      assert.equal(await page.locator('#skList .sk-card').count(), 0);
      await page.locator('#lbQ').fill('');
      await page.locator('#lbAdd').click();
      await page.locator('.tk-menu button').filter({ hasText:'مهارة جديدة' }).click();
      await page.locator('#skeName').fill('مهارة تجريبية محلية');
      await page.locator('#skeDesc').fill('التحقق من بقاء الإضافة بعد نقل القسم');
      await page.locator('#skeWhen').fill('عند إجراء اختبار محلي');
      await page.locator('#skeBody').fill('1. استخدم بيانات الاختبار فقط.');
      await page.locator('.rs-ov [data-save]').click();
      await page.locator('#skList .sk-card').filter({ hasText:'مهارة تجريبية محلية' }).waitFor();
      await page.screenshot({ path:`${out}/skills-${viewport.width}.png`, fullPage:true });
      await page.locator('#lbAdd').click();
      await page.locator('.tk-menu button').filter({ hasText:'إعدادات المهارات' }).click();
      await page.waitForFunction(() => location.hash === '#/settings/custom');
      assert.equal(await page.locator('#skillsSettingsRoot #sksOn').isVisible(), true);
      assert.equal(await page.locator('.rs-ov').count(), 0);
      await page.locator('#sksOn').uncheck();
      assert.equal(await page.evaluate(() => settings.skills.enabled), false);
      assert.equal(await page.evaluate(() => currentId), 'integration-test-chat');
      await page.locator('#manageSkills').click();
      await page.waitForFunction(() => location.hash === '#/library/skills');
      await page.locator('#lbTabs [data-tab="template"]').click();
      assert.equal(await page.locator('#skView').isVisible(), false);
      assert.equal(await page.locator('#lbGrid').isVisible(), true);
      assert.equal(await page.locator('#lbAdd').isVisible(), true);

      // Old task route resolves to the Library tasks tab.
      await page.evaluate(() => showChatView()); await page.waitForTimeout(100);
      await page.evaluate(() => { location.hash = '#/tasks'; });
      await page.waitForFunction(() => location.hash === '#/library/tasks');
      await page.screenshot({ path:`${out}/tasks-${viewport.width}.png`, fullPage:true });
      await page.evaluate(() => showChatView());
      assert.equal(await composer.inputValue(), 'مسودة يجب الاحتفاظ بها');
      await page.reload();
      await page.waitForFunction(() => window.__openSkills && document.getElementById('gate').hidden);
      await page.evaluate(() => window.__openMemory());
      assert.equal(await page.locator('#mmList .mm-card').filter({ hasText:'أفضل الاختبارات المحلية' }).count(), 1);
      await page.evaluate(() => window.__openSkills());
      assert.equal(await page.locator('#skList .sk-card').filter({ hasText:'مهارة تجريبية محلية' }).count(), 1);
      assert.equal(await page.evaluate(() => settings.skills.enabled), false);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false, 'horizontal viewport overflow');
      assert.deepEqual(errors, [], 'runtime errors');
      report.push({ viewport, checks:'passed', runtimeErrors:errors });
      await page.close();
    }
    fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
