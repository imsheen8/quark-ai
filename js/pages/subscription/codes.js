/* QUARK AI — الخطط (مجاني · بلس · برو · برو ماكس) وأكواد التفعيل والإحالة. التفعيل كله على الخادم. */
'use strict';

const PLAN_IDS = ['free', 'plus', 'pro', 'max'];
const PLAN_LABEL = { free:'مجاني', plus:'بلس', pro:'برو', max:'برو ماكس' };
/* قيم احتياطية تطابق افتراضات الوسيط؛ تُستبدل بما يردّه الوسيط (/plans) عند التوفر */
let PLAN_LIMITS = { free:{ limit:25, cloudMb:5 }, plus:{ limit:50, cloudMb:20 }, pro:{ limit:100, cloudMb:50 }, max:{ limit:250, cloudMb:200 } };
let REF_RULES = { inviteeDays:3, inviterDays:3, plan:'pro', maxRewards:20, minMsgs:3, windowDays:7 };
let refCache = null;                      /* بيانات إحالة هذا الحساب من /me (ذاكرة فقط) */
const FREE_THEMES = 1, PRO_THEMES = 50;

const CODE_AL = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const normCode = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const validCodeLen = c => c.length >= 4 && c.length <= 16;   /* اشتراك/إحالة 8 رموز، والترويجي 4–16 */
const prettyCode = c => (c.length === 8 ? c.slice(0, 4) + '-' + c.slice(4) : c);

const getSub = () => store.get('ai_sub', null);
const subActive = s => !!s && (s.exp === null || s.exp > Date.now());
/* الخطة الحالية: الاشتراكات القديمة بلا plan تُعدّ برو */
const planId = () => { const s = getSub(); return subActive(s) ? (['plus', 'pro', 'max'].includes(s.plan) ? s.plan : 'pro') : 'free'; };
const planLabel = p => PLAN_LABEL[p] || PLAN_LABEL.free;
const isPro = () => planId() !== 'free';      /* أي خطة مدفوعة (تفتح الثيمات المخصصة بلا حدود) */

const subApi = async (method, path, body) => {
  const a = window.QuarkAuth && window.QuarkAuth.session();
  if (!a || !MANAGED_URL) return null;
  try{
    const r = await fetch(String(MANAGED_URL).replace(/\/+$/, '') + path, { method, cache:'no-store', body:body ? JSON.stringify(body) : undefined,
      headers:{ authorization:'Bearer ' + ((MANAGED_SECRET ? MANAGED_SECRET + ':' : '') + a.token), ...(body ? { 'content-type':'application/json' } : {}) } });
    return { s:r.status, j:await r.json().catch(() => ({})) };
  }catch{ return null; }
};
/* حدود الخطط وقواعد الإحالة من الوسيط (عامة، بلا تسجيل دخول) */
async function loadPlans(){
  if (!MANAGED_URL) return false;
  try{
    const r = await fetch(String(MANAGED_URL).replace(/\/+$/, '') + '/plans', { cache:'no-store' });
    if (!r.ok) return false;
    const j = await r.json();
    for (const p of (j.plans || [])) if (PLAN_LIMITS[p.id]) PLAN_LIMITS[p.id] = { limit:p.limit, cloudMb:p.cloudMb };
    if (j.ref) REF_RULES = { ...REF_RULES, ...j.ref };
    return true;
  }catch{ return false; }
}
const saveSub = (j, cur) => store.set('ai_sub', { plan:j.plan || 'pro', exp:j.exp, since:j.since || (cur && cur.since) || Date.now(), server:true });

async function redeemCode(raw){
  const c = normCode(raw);
  if (!validCodeLen(c)) return { ok:false, msg:'الكود غير صحيح. تحقق منه وحاول مجددًا.' };
  if (!(window.QuarkAuth && window.QuarkAuth.session())) return { ok:false, msg:'سجّل الدخول بحساب Google أولًا لتفعيل الكود.' };
  const r = await subApi('POST', '/redeem', { code:c });
  if (!r) return { ok:false, msg:'تعذّر الاتصال بالخدمة. تحقق من الإنترنت وحاول مجددًا.' };
  if (r.s !== 200) return { ok:false, msg:(r.j && r.j.error && r.j.error.message) || 'تعذّر تفعيل الكود.' };
  if (r.j.pro) saveSub(r.j, getSub());
  if (r.j.referral) refCache = r.j.referral;
  return { ok:true, kind:r.j.kind, plan:r.j.plan, exp:r.j.exp, label:r.j.label, days:r.j.days || 0, upgraded:!!r.j.upgraded };
}
/* يطابق الاشتراك المحلي مع الخادم (عند الفتح وبعد التفعيل). الاشتراكات القديمة المحلية تبقى للواجهة حتى انتهائها. */
async function syncSub(){
  const r = await subApi('GET', '/me');
  if (!r || r.s !== 200) return false;
  const cur = getSub();
  if (r.j.pro) saveSub(r.j, cur);
  else if (cur && cur.server) store.set('ai_sub', null);
  if (r.j.referral) refCache = r.j.referral;
  return true;
}
