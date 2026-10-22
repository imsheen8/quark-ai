// رسالة الحظر (parseBan) وصفحة الإشعارات (notices.js) — بلا متصفح
const fs = require('fs'); const vm = require('vm');
let ok = 0, bad = 0; const t = (n, c) => { console.log((c ? '✓ ' : '✗ ') + n); c ? ok++ : bad++; };
const rd = (p) => fs.readFileSync(__dirname + '/../' + p, 'utf8');

/* ── parseBan: النص نفسه الذي يرسله الوسيط (proxy/src/index.js → banText) ── */
const mctx = { settings: { endpoints: [], sel: null }, persistSettings() {}, store: { get: (k, d) => d, set() {} }, crypto: require('crypto').webcrypto, window: {}, fetch: async () => ({ ok: false }), console };
vm.createContext(mctx);
vm.runInContext(rd('js/features/managed.js') + '\nthis.parseBan = parseBan', mctx);
const parseBan = mctx.parseBan;
const MSG = 'تم إيقاف حسابك.\nالسبب: إساءة استخدام الخدمة\nإن كنت ترى أن هذا خطأ فتواصل مع الدعم.';
let b = parseBan(MSG);
t('يتعرّف على رسالة الحظر ويستخرج السبب', b && b.reason === 'إساءة استخدام الخدمة');
t('يستخرج سطر المساعدة', b && /تواصل مع الدعم/.test(b.help));
t('يتعرّف عليها مع بادئة (403) أيضًا', (parseBan('(403) ' + MSG) || {}).reason === 'إساءة استخدام الخدمة');
t('خطأ عادي ليس حظرًا', parseBan('انتهت رسائلك اليومية (25). تتجدد غدًا.') === null && parseBan('') === null && parseBan(null) === null);
t('سبب مفقود → سبب افتراضي', (parseBan('تم إيقاف حسابك.') || {}).reason === 'مخالفة شروط الاستخدام');

/* ── errText: لا يضيف «(403)» ولا «مفتاح غير صالح» على رد الحظر ── */
const apiSrc = rd('js/features/model-api.js');
const eStart = apiSrc.indexOf('async function errText'), eEnd = apiSrc.indexOf('async function* openaiStyle');
const ectx = { parseBan, console }; vm.createContext(ectx);
vm.runInContext(apiSrc.slice(eStart, eEnd) + '\nthis.errText = errText', ectx);
(async () => {
  const mk = (status, body) => ({ status, statusText: 'x', json: async () => body });
  let r = await ectx.errText(mk(403, { error: { message: MSG, code: 'banned', reason: 'إساءة استخدام الخدمة' } }));
  t('errText: رد الحظر يُعاد كما هو بلا بادئة', r === MSG);
  r = await ectx.errText(mk(403, { error: { message: 'forbidden', code: 'other' } }));
  t('errText: بقية الأخطاء كما كانت', r === '(403) forbidden');
  r = await ectx.errText(mk(429, { error: { message: 'x' } }));
  t('errText: 429 كما كان', r.startsWith('(429) تجاوزت حد الطلبات.'));

  /* ── notices.js ── */
  const kv = {}; const els = {};
  const mkEl = (id) => (els[id] = { id, hidden: true, textContent: '', innerHTML: '', offsetParent: {}, classList: { on: false, toggle(_, v) { this.on = !!v; } } });
  const panel = { hidden: false };
  const doc = { hidden: false, getElementById: (id) => els[id] || null, querySelector: (q) => (/notices/.test(q) ? panel : null), addEventListener() {} };
  mkEl('ntRoot'); mkEl('ntTabDot'); mkEl('setInfo');
  let items = [{ id: 'a1', title: 'صيانة', body: 'سطر 1\nسطر 2', at: Date.now() - 5000 }, { id: 'b2', title: '<img src=x onerror=1>', body: '<script>x</script>', at: Date.now() - 86400e3 * 3 }];
  let fail = false, calls = 0;
  const timers = [];
  const ctx = {
    window: {}, document: doc, console, MANAGED_URL: 'https://x.test/qk',
    store: { get: (k, d) => (k in kv ? kv[k] : d), set: (k, v) => { kv[k] = JSON.parse(JSON.stringify(v)); } },
    esc: (s) => String(s).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';'),
    fetch: async (u) => { calls++; if (fail) throw new Error('net'); return { ok: true, json: async () => ({ items }) }; },
    setTimeout: (f) => { timers.push(f); return 0; }, setInterval: () => 0, clearTimeout() {}, AbortController, Promise,
  };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(rd('js/pages/settings/notices.js'), ctx);
  const flush = () => new Promise((r) => setImmediate(r));
  t('لا غير مقروء قبل أول جلب', ctx.__ntUnread() === 0);
  timers[0](); await flush(); await flush();
  t('الجلب الهادئ يعدّ غير المقروء (2) ويظهر العدّاد', ctx.__ntUnread() === 2 && els.ntTabDot.hidden === false && els.ntTabDot.textContent === '2' && els.setInfo.classList.on === true);
  t('طُلب المسار /notices على الوسيط', calls === 1);
  ctx.__ntOpen(); await flush(); await flush();
  t('فتح الصفحة يعرض الإشعارين', (els.ntRoot.innerHTML.match(/class="nt-card/g) || []).length === 2);
  t('النص يُعرض كنص فقط (لا HTML حي)', !/<img |<script/.test(els.ntRoot.innerHTML) && els.ntRoot.innerHTML.includes('&#60;img'));
  t('بعد الفتح صار كله مقروءًا والعدّاد اختفى', ctx.__ntUnread() === 0 && els.ntTabDot.hidden === true && els.setInfo.classList.on === false);
  t('تُحفظ نسخة محلية', kv.ai_notices && kv.ai_notices.items.length === 2 && kv.ai_notices.seen.length === 2);
  items = items.concat([{ id: 'c3', title: 'جديد', body: 'x', at: Date.now() }]);
  ctx.__ntOpen(); await flush(); await flush();
  t('إشعار جديد يُعلَّم «جديد» مرة واحدة فقط', (els.ntRoot.innerHTML.match(/class="nt-new"/g) || []).length === 1);
  fail = true; ctx.__ntOpen(); await flush(); await flush();
  t('بلا اتصال: يعرض المحفوظ مع ملاحظة التعذّر', els.ntRoot.innerHTML.includes('nt-card') && els.ntRoot.innerHTML.includes('تعذّر تحديث الإشعارات'));
  fail = false; items = [items[0]]; ctx.__ntOpen(); await flush(); await flush();
  t('الإشعار الذي حذفه المطوّر يختفي ويُنظَّف معرّفه', (els.ntRoot.innerHTML.match(/class="nt-card/g) || []).length === 1 && !kv.ai_notices.seen.includes('b2'));
  items = []; ctx.__ntOpen(); await flush(); await flush();
  t('لا إشعارات → حالة فارغة', els.ntRoot.innerHTML.includes('لا توجد إشعارات حاليًا'));

  /* ── ملفات الواجهة: ديسكورد اختفى من «حول التطبيق»، والإشعارات مكانه في القائمة ── */
  const html = rd('pages/settings/settings.html'), nav = rd('js/pages/settings/settings-nav.js');
  t('«حول التطبيق» بلا ديسكورد ولا قسم الروابط', !/discord|ديسكورد|الروابط/i.test(html));
  t('القائمة ⓘ: الإشعارات بدل ديسكورد', !/discord|ديسكورد/i.test(nav) && /data-go="notices"[^`]*الإشعارات/.test(nav) && /notices:'الإشعارات'/.test(nav));
  t('لوحة الإشعارات موجودة في الصفحة ومسجّلة في المانيفست', /data-panel="notices"/.test(html) && /id="ntRoot"/.test(html) && /settings\/notices\.js/.test(rd('js/manifest.js')) && /settings\/notices\.css/.test(rd('index.html')));
  t('أيقونة الجرس مضافة', /id="i-bell"/.test(rd('components/icons-sprite.html')));
  console.log(`${ok}/${ok + bad}`); process.exit(bad ? 1 : 0);
})();
