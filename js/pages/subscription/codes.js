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
function redeemCode(raw){
  const p = parseCode(raw);
  if (!p) return { ok:false, msg:'الكود غير صحيح. تحقق منه وحاول مجددًا.' };
  const used = store.get('ai_sub_used', []);
  if (used.includes(p.code)) return { ok:false, msg:'استُخدم هذا الكود من قبل على هذا الجهاز.' };
  const s = getSub(), now = Date.now(); let exp;
  if (p.days === null || (s && s.exp === null && isPro())) exp = null;
  else exp = ((s && s.exp !== null && s.exp > now) ? s.exp : now) + p.days * 864e5;
  store.set('ai_sub', { plan:'pro', exp, since:s?.since || now, code:p.code });
  store.set('ai_sub_used', [...used, p.code].slice(-50));
  return { ok:true, label:p.label, exp };
}
