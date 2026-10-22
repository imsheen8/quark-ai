/* QUARK AI — أكواد الاشتراك: التحقق والاسترداد */
'use strict';

/* ----- الاشتراك: أكواد من 8 رموز (حرف النوع + 5 عشوائية + 2 تحقق) ----- */
const CODE_AL = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', SUB_SALT = 'qk7-pro-3f9a1c';
const SUB_TYPES = { M:{ days:30, label:'شهر' }, Y:{ days:365, label:'سنة' }, L:{ days:null, label:'مدى الحياة' } };
const FREE_THEMES = 1, PRO_THEMES = 50;
function codeSum(body){
  let h = 2166136261; const t = body + SUB_SALT;
  for (let i = 0; i < t.length; i++){ h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return CODE_AL[h % 32] + CODE_AL[(h >>> 5) % 32];
}
const normCode = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function parseCode(raw){
  const c = normCode(raw);
  if (c.length !== 8 || [...c].some(ch => !CODE_AL.includes(ch))) return null;
  if (codeSum(c.slice(0, 6)) !== c.slice(6)) return null;
  const t = SUB_TYPES[c[0]]; return t ? { code:c, ...t } : null;
}
const getSub = () => store.get('ai_sub', null);
const isPro = () => { const s = getSub(); return !!s && (s.exp === null || s.exp > Date.now()); };
/* التفعيل صار على الخادم: كود عشوائي يُستعمل مرة واحدة ويُربط بحساب Google، والخادم هو من يحدّد حدّ الرسائل والمساحة السحابية.
   (حالة برو المحفوظة هنا للواجهة فقط؛ ما يهمّ فعلًا يُفرَض في الوسيط.) */
const subApi = async (method, path, body) => {
  const a = window.QuarkAuth && QuarkAuth.session();
  if (!a || !MANAGED_URL) return null;
  try{
    const r = await fetch(String(MANAGED_URL).replace(/\/+$/, '') + path, { method, cache:'no-store', body:body ? JSON.stringify(body) : undefined,
      headers:{ authorization:'Bearer ' + ((MANAGED_SECRET ? MANAGED_SECRET + ':' : '') + a.token), ...(body ? { 'content-type':'application/json' } : {}) } });
    return { s:r.status, j:await r.json().catch(() => ({})) };
  }catch{ return null; }
};
async function redeemCode(raw){
  const c = normCode(raw);
  if (c.length !== 8) return { ok:false, msg:'الكود غير صحيح. تحقق منه وحاول مجددًا.' };
  if (!(window.QuarkAuth && QuarkAuth.session())) return { ok:false, msg:'سجّل الدخول بحساب Google أولًا لتفعيل الاشتراك.' };
  const r = await subApi('POST', '/redeem', { code:c });
  if (!r) return { ok:false, msg:'تعذّر الاتصال بالخدمة. تحقق من الإنترنت وحاول مجددًا.' };
  if (r.s !== 200) return { ok:false, msg:(r.j && r.j.error && r.j.error.message) || 'تعذّر تفعيل الكود.' };
  const s = getSub(), now = Date.now();
  store.set('ai_sub', { plan:'pro', exp:r.j.exp, since:(s && s.since) || now, server:true });
  return { ok:true, label:r.j.label, exp:r.j.exp };
}
/* يطابق الاشتراك المحلي مع الخادم (عند الفتح وبعد التفعيل). الاشتراكات القديمة المحلية تبقى للواجهة حتى انتهائها. */
async function syncSub(){
  const r = await subApi('GET', '/me');
  if (!r || r.s !== 200) return false;
  const cur = getSub();
  if (r.j.pro) store.set('ai_sub', { plan:'pro', exp:r.j.exp, since:r.j.since || (cur && cur.since) || Date.now(), server:true });
  else if (cur && cur.server) store.set('ai_sub', null);
  return true;
}
