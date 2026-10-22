// الخطط في الواجهة: codes.js (الحالة/التفعيل/الإحالة) وplan.js (البطاقات) وبطاقة الإعدادات — بلا متصفح
const fs = require('fs'), vm = require('vm');
let ok = 0, bad = 0; const t = (n, c) => { console.log((c ? '✓ ' : '✗ ') + n); c ? ok++ : bad++; };
const rd = (p) => fs.readFileSync(__dirname + '/../' + p, 'utf8');
const kv = {}; let calls = [], serverReply = null;
const els = {}; const mkEl = (id) => els[id] || (els[id] = { id, hidden: false, textContent: '', innerHTML: '', value: '', disabled: false, className: '', handlers: {}, addEventListener(e, f) { this.handlers[e] = f; } });
const ctx = {
  store: { get: (k, d) => (k in kv ? kv[k] : d), set: (k, v) => { kv[k] = v; } }, MANAGED_URL: 'https://x.test/qk', MANAGED_SECRET: '',
  window: { QuarkAuth: { session: () => ({ token: 'qs.tok' }) } }, console, esc: (s) => String(s), $: (id) => mkEl(id), document: { addEventListener() {} },
  applyTheme() {}, renderMessages() {}, qConfirm: async () => true, copyText: async () => true, navigator: {},
  fetch: async (url, o = {}) => { calls.push({ url, method: o.method || 'GET', body: o.body }); const r = serverReply(url, o); return { ok: r.s === 200, status: r.s, json: async () => r.j }; },
};
vm.createContext(ctx);
vm.runInContext(rd('js/pages/subscription/codes.js') + '\nthis.api={planId,planLabel,isPro,redeemCode,syncSub,loadPlans,normCode,validCodeLen,prettyCode,getSub,PLAN_LIMITS:()=>PLAN_LIMITS,REF:()=>REF_RULES,ref:()=>refCache}', ctx);
vm.runInContext(rd('js/pages/subscription/plan.js'), ctx);
const A = ctx.api;
(async () => {
  t('بلا اشتراك: مجاني', A.planId() === 'free' && !A.isPro() && A.planLabel(A.planId()) === 'مجاني');
  kv.ai_sub = { plan: 'pro', exp: null }; t('برو مدى الحياة', A.planId() === 'pro' && A.isPro());
  kv.ai_sub = { exp: Date.now() + 1e6 }; t('اشتراك قديم بلا plan = برو', A.planId() === 'pro');
  kv.ai_sub = { plan: 'max', exp: Date.now() + 1e6 }; t('برو ماكس', A.planId() === 'max' && A.planLabel('max') === 'برو ماكس');
  kv.ai_sub = { plan: 'plus', exp: Date.now() - 1 }; t('منتهي = مجاني', A.planId() === 'free');
  kv.ai_sub = { plan: 'gold', exp: null }; t('خطة مجهولة تُعدّ برو', A.planId() === 'pro');
  t('طول الكود: اشتراك/إحالة 8 وترويجي 4–16', A.validCodeLen('ABCD2345') && A.validCodeLen('WELCOME7') && !A.validCodeLen('ABC') && !A.validCodeLen('X'.repeat(17)));
  t('تنسيق الكود', A.prettyCode('ABCD2345') === 'ABCD-2345' && A.prettyCode('WELCOME7XYZ') === 'WELCOME7XYZ' && A.normCode('ab-cd 23') === 'ABCD23');

  serverReply = (u) => ({ s: 200, j: { plans: [{ id: 'free', limit: 20, cloudMb: 4 }, { id: 'max', limit: 300, cloudMb: 300 }], ref: { inviteeDays: 5, inviterDays: 7, plan: 'pro', maxRewards: 10, minMsgs: 2, windowDays: 7 } } });
  t('loadPlans يقرأ الحدود وقواعد الإحالة', await A.loadPlans() && A.PLAN_LIMITS().max.limit === 300 && A.PLAN_LIMITS().plus.limit === 50 && A.REF().inviteeDays === 5);
  t('/plans بلا ترويسة تفويض', calls.at(-1).url === 'https://x.test/qk/plans');

  kv.ai_sub = null;
  serverReply = (u, o) => ({ s: 200, j: { pro: true, plan: 'plus', exp: Date.now() + 30 * 864e5, kind: 'sub', label: 'شهر', upgraded: false, referral: { code: 'RABC-DEFG', rewarded: 1, pending: 0, daysEarned: 7 } } });
  let r = await A.redeemCode('abcd-2345');
  t('تفعيل كود اشتراك يحفظ الخطة والإحالة', r.ok && r.kind === 'sub' && kv.ai_sub.plan === 'plus' && kv.ai_sub.server && A.ref().code === 'RABC-DEFG' && JSON.parse(calls.at(-1).body).code === 'ABCD2345');
  serverReply = () => ({ s: 200, j: { pro: true, plan: 'pro', exp: Date.now() + 3 * 864e5, kind: 'ref', label: '3 أيام', days: 3 } });
  r = await A.redeemCode('RXYZ-1234'); t('كود إحالة: النتيجة kind=ref', r.ok && r.kind === 'ref' && kv.ai_sub.plan === 'pro');
  serverReply = () => ({ s: 400, j: { error: { message: 'استخدمتَ كود إحالة من قبل. يُسمح بكود واحد لكل حساب.' } } });
  r = await A.redeemCode('RXYZ-1234'); t('رسالة الخطأ من الخادم تصل كما هي', !r.ok && /كود واحد/.test(r.msg));
  const n = calls.length; r = await A.redeemCode('ab'); t('كود قصير يُرفض محليًا دون طلب', !r.ok && calls.length === n);
  ctx.window.QuarkAuth.session = () => null; r = await A.redeemCode('ABCD2345'); t('بلا تسجيل دخول: رسالة واضحة', !r.ok && /سجّل الدخول/.test(r.msg)); ctx.window.QuarkAuth.session = () => ({ token: 'qs.tok' });

  kv.ai_sub = { plan: 'pro', exp: Date.now() + 1e6, server: true };
  serverReply = () => ({ s: 200, j: { pro: false, plan: 'free', exp: 0 } }); await A.syncSub(); t('syncSub: انتهى على الخادم → يُمسح المحلي', kv.ai_sub === null);
  kv.ai_sub = { plan: 'pro', exp: 5, server: false };
  serverReply = () => ({ s: 200, j: { pro: true, plan: 'max', exp: null, since: 1, referral: { code: 'RAAA-BBBB' } } }); await A.syncSub(); t('syncSub: ترقية من الخادم إلى ماكس', kv.ai_sub.plan === 'max' && kv.ai_sub.exp === null);

  // صفحة الاشتراك: الأربع بطاقات وتمييز الحالية
  kv.ai_sub = { plan: 'plus', exp: Date.now() + 1e9, server: true };
  ctx.renderPlan(); const html = els.planCards.innerHTML;
  t('الصفحة تعرض 4 بطاقات', (html.match(/class="plan-card /g) || []).length === 4 && ['مجاني', 'بلس', 'برو', 'برو ماكس'].every((x) => html.includes('>' + x)));
  t('الخطة الحالية موسومة (بلس فقط)', (html.match(/خطتك الحالية/g) || []).length === 1 && /p-plus cur/.test(html));
  t('الأرقام من حدود الوسيط', html.includes('300') || html.includes('٣٠٠'));
  t('حالة الاشتراك ظاهرة', !els.planStatus.hidden && /بلس/.test(els.planStatus.textContent));
  kv.ai_sub = null; ctx.renderPlan(); t('مجاني: بلا شارة حالة وبطاقة المجاني هي الحالية', els.planStatus.hidden && /p-free cur/.test(els.planCards.innerHTML));
  t('بطاقة الملف الشخصي تتبع الخطة', els.upBtn.textContent === 'ترقية');
  kv.ai_sub = { plan: 'max', exp: null, server: true }; ctx.renderPlan(); t('بطاقة الملف: مشترك في برو ماكس', /برو ماكس/.test(els.upTitle.textContent) && els.upBtn.textContent === 'إدارة الاشتراك');
  // الإحالة
  t('بطاقة الإحالة تعرض الكود', !els.planRefBox.hidden && els.planRefCode.textContent === 'RAAA-BBBB' && /[5٥]/.test(els.planRefDesc.textContent));
  t('عدّادات الإحالة', /يوم ربحتها/.test(els.planRefStats.innerHTML));
  // بطاقة الإعدادات: عرض فقط
  const nav = rd('js/pages/settings/settings-nav.js');
  t('بطاقة الاسم والخطة في الإعدادات ليست زرًّا ولا تفتح شيئًا', /<div class=\\"sh-card sh-acc sh-static\\"|<div class="sh-card sh-acc sh-static"/.test(nav) && !/sh-card sh-acc[^`]*data-go/.test(nav));
  t('وتعرض اسم الخطة', /planLabel\(planId\(\)\)/.test(nav));
  console.log(`${ok}/${ok + bad}`); process.exit(bad ? 1 : 0);
})();
