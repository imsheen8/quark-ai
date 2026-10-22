// واجهة حقيقية: الإشعارات بدل ديسكورد، «حول التطبيق» بلا ديسكورد، ورسالة الحظر في المحادثة (الوسيط مُحاكى بالشبكة)
const { chromium } = require('playwright');
const SHOT = process.env.SHOT || '';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 412, height: 860 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('ai_intro', 'false'); localStorage.setItem('ai_onboarded', 'true'); } catch {} });
  const p = await ctx.newPage(); let ok = 0, bad = 0; const t = (n, c) => { console.log((c ? '✓ ' : '✗ ') + n); c ? ok++ : bad++; };
  const NOTICES = [{ id: 'n2', title: 'تحديث جديد', body: 'أضفنا ميزات جديدة.\nجرّبها الآن.', at: Date.now() - 3600e3 }, { id: 'n1', title: 'صيانة الليلة', body: 'قد تتوقف الخدمة دقائق.', at: Date.now() - 86400e3 * 2 }];
  const BAN = 'تم إيقاف حسابك.\nالسبب: إساءة استخدام الخدمة\nإن كنت ترى أن هذا خطأ فتواصل مع الدعم.';
  let banned = true;
  await p.route('**/qk/notices', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ items: NOTICES }) }));
  await p.route('**/qk/chat', r => r.fulfill({ status: 403, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: { message: BAN, type: 'banned', code: 'banned', reason: 'إساءة استخدام الخدمة' } }) }));
  await p.route('**/qk/usage', r => r.fulfill({ status: 403, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: { message: BAN, code: 'banned' } }) }));
  await p.goto('http://localhost:8123/index.html'); await p.waitForFunction(() => typeof openSettings === 'function', null, { timeout: 25000 });
  await p.addStyleTag({ content: '#qiHost,#qiCover{display:none!important}' });
  await p.waitForTimeout(4500);   // الجلب الهادئ بعد 3 ثوانٍ
  await p.evaluate(() => openSettings('home')); await p.waitForTimeout(500);
  t('نقطة حمراء على زر ⓘ للإشعارات غير المقروءة', await p.evaluate(() => document.getElementById('setInfo').classList.contains('has-nt')));
  await p.click('#setInfo'); await p.waitForTimeout(300);
  const pop = await p.evaluate(() => document.getElementById('shPop').innerText);
  t('القائمة: الإشعارات + حول التطبيق، بلا ديسكورد', /الإشعارات/.test(pop) && /حول التطبيق/.test(pop) && !/ديسكورد|discord/i.test(pop));
  t('عدّاد غير المقروء (2) بجانب الإشعارات', await p.evaluate(() => document.querySelector('#shPop .nt-badge')?.textContent === '2'));
  if (SHOT) await p.screenshot({ path: SHOT + '-menu.png' });
  await p.click('#shPop [data-go="notices"]'); await p.waitForTimeout(900);
  const pg = await p.evaluate(() => ({ title: document.getElementById('setTitle').textContent, cards: document.querySelectorAll('#ntRoot .nt-card').length, txt: document.getElementById('ntRoot').innerText, vis: document.getElementById('ntRoot').offsetParent !== null }));
  t('صفحة الإشعارات تفتح بعنوانها وتعرض الإشعارين', pg.vis && pg.title === 'الإشعارات' && pg.cards === 2 && /تحديث جديد/.test(pg.txt) && /صيانة الليلة/.test(pg.txt));
  if (SHOT) await p.screenshot({ path: SHOT + '-page.png' });
  t('بعد الفتح اختفت النقطة', await p.evaluate(() => !document.getElementById('setInfo').classList.contains('has-nt')));
  await p.evaluate(() => selectTab('home')); await p.waitForTimeout(300);
  t('الرجوع للرئيسية ثم فتح القائمة: بلا عدّاد', await p.evaluate(() => { document.getElementById('setInfo').click(); return !document.querySelector('#shPop .nt-badge'); }));
  await p.click('#shPop [data-go="about"]'); await p.waitForTimeout(500);
  const ab = await p.evaluate(() => document.querySelector('.tab-panel[data-panel="about"]').innerText);
  t('«حول التطبيق»: المطوّر والشركة والإصدار فقط، بلا ديسكورد ولا «الروابط»', /المطوّر/.test(ab) && /KRAZOS/.test(ab) && /v1\.0/.test(ab) && !/ديسكورد|discord|الروابط/i.test(ab));
  if (SHOT) await p.screenshot({ path: SHOT + '-about.png' });
  // رسالة الحظر في المحادثة (المسار المباشر من المتصفح؛ مسار البوابة يغطيه tests/e2e_gateway_ban.js)
  await p.evaluate(() => { settings.gw.mode = 'off'; });
  await p.evaluate(() => { closeSettings(); });
  await p.evaluate(() => { try { document.querySelector('#newChat, [data-new]')?.click(); } catch {} });
  await p.waitForTimeout(400);
  await p.evaluate(() => { const i = document.getElementById('input') || document.querySelector('textarea'); i.value = 'مرحبا'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.evaluate(() => { (document.getElementById('send') || document.querySelector('.send')).click(); });
  await p.waitForSelector('.msg.error.banned', { timeout: 15000 }).catch(() => {});
  const card = await p.evaluate(() => { const m = document.querySelector('.msg.error.banned'); return m ? { t: m.querySelector('.ban-t')?.innerText, r: m.querySelector('.ban-r')?.innerText, h: m.querySelector('.ban-h')?.innerText, all: m.innerText } : null; });
  t('رد banned يعرض بطاقة حظر مفهومة بدل خطأ عام', !!card && /تم إيقاف حسابك/.test(card.t) && /إساءة استخدام الخدمة/.test(card.r) && /تواصل مع الدعم/.test(card.h));
  t('لا تظهر عبارات الخطأ العامة (403 / مفتاح غير صالح)', !!card && !/\(403\)|مفتاح API|تعذّر الاتصال/.test(card.all));
  if (SHOT) await p.screenshot({ path: SHOT + '-ban.png' });
  console.log(ok + '/' + (ok + bad)); await b.close(); process.exit(bad ? 1 : 0);
})();
