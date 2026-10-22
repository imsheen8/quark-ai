/* QUARK AI — صفحة الاشتراك: بطاقات الخطط، تفعيل الأكواد، الإحالة */
'use strict';

function fmtDate(t){ try{ return new Date(t).toLocaleDateString('ar', { year:'numeric', month:'long', day:'numeric' }); }catch{ return new Date(t).toDateString(); } }
const checkLi = (t, off) => `<li${off ? ' class="off"' : ''}><svg class="i"><use href="#i-check"/></svg><span>${esc(t)}</span></li>`;
const nf = n => Number(n).toLocaleString('ar-EG');
const mbText = mb => nf(mb) + ' ميغابايت';

/* مزايا كل خطة (الأرقام من الوسيط) */
function planFeatures(id){
  const L = PLAN_LIMITS[id] || {};
  const base = [`${nf(L.limit)} رسالة يوميًا`, `مساحة سحابية ${mbText(L.cloudMb)} لمحادثاتك وإعداداتك`];
  const f = {
    free:[ 'نموذج خفيف وسريع للاستخدام اليومي', ...base, 'كل الثيمات الجاهزة الفاتحة والداكنة', 'ثيم مخصص واحد' ],
    plus:[ 'نموذج أسرع وأذكى من المجاني', ...base, 'ردود ومحادثات أطول', 'ثيمات مخصصة بلا حدود (حتى 50 ثيمًا)' ],
    pro:[ 'كل ما في بلس', 'نموذج أقوى للمهام الصعبة', ...base, 'ردود ومحادثات أطول بكثير' ],
    max:[ 'كل ما في برو', 'أقوى نموذج متاح وأعلى أولوية', ...base, 'أطول ردود وأكبر محادثات' ],
  };
  return f[id];
}
const PLAN_DESC = { free:'للبدء والاستخدام اليومي', plus:'للاستخدام الأكثر انتظامًا', pro:'للاحتراف والمهام الصعبة', max:'أقصى ما يقدّمه QUARK' };

function renderCards(){
  const cur = planId(), s = getSub();
  $('planCards').innerHTML = PLAN_IDS.map(id => {
    const isCur = id === cur, hot = id === 'pro';
    const st = isCur && id !== 'free' && s ? `<div class="plan-until">${s.exp === null ? 'فعّالة مدى الحياة' : 'فعّالة حتى ' + fmtDate(s.exp)}</div>` : '';
    return `<div class="plan-card p-${id}${isCur ? ' cur' : ''}${hot && !isCur ? ' hot' : ''}" data-plan="${id}">
      <h2>${esc(planLabel(id))}${isCur ? '<span class="plan-tag">خطتك الحالية</span>' : hot ? '<span class="plan-tag soft">الأكثر اختيارًا</span>' : ''}</h2>
      <p class="plan-desc">${esc(PLAN_DESC[id])}</p>${st}
      <ul class="plan-list">${planFeatures(id).map(t => checkLi(t)).join('')}</ul></div>`;
  }).join('');
}
function renderPlan(){
  const cur = planId(), s = getSub(), paid = cur !== 'free';
  const st = $('planStatus'); st.hidden = !paid;
  if (paid) st.textContent = s.exp === null ? `اشتراكك في ${planLabel(cur)} فعّال مدى الحياة.` : `اشتراكك في ${planLabel(cur)} فعّال حتى ${fmtDate(s.exp)}.`;
  renderCards();
  $('planCodeTitle').textContent = paid ? 'تمديد أو ترقية' : 'لديك كود؟';
  $('planRemove').hidden = !paid || !!(s && s.server);   /* اشتراك الخادم لا يُزال من الجهاز */
  renderRef();
  renderProfileCard();
}
/* بطاقة «تريد المزيد؟» في الملف الشخصي */
function renderProfileCard(){
  const cur = planId(), s = getSub(), paid = cur !== 'free';
  if (!$('upTitle')) return;
  $('upTitle').textContent = paid ? 'أنت مشترك في ' + planLabel(cur) : 'تريد المزيد؟';
  $('upText').textContent = paid ? (s.exp === null ? 'اشتراكك فعّال مدى الحياة.' : 'اشتراكك فعّال حتى ' + fmtDate(s.exp) + '.') : 'رقّ حسابك لنموذج أقوى ورسائل أكثر ومساحة أكبر.';
  $('upBtn').textContent = paid ? 'إدارة الاشتراك' : 'ترقية';
}

/* ---------- الإحالة ---------- */
const refShareText = code => `جرّب QUARK AI! أدخل كود الإحالة ${code} في صفحة الاشتراك فنحصل كلانا على ${nf(REF_RULES.inviteeDays)} أيام ${planLabel(REF_RULES.plan)} مجانًا.`;
function renderRef(){
  const logged = !!(window.QuarkAuth && window.QuarkAuth.session()), r = refCache;
  $('planRefDesc').textContent = `شارك كودك مع صديق: يحصل هو على ${nf(REF_RULES.inviteeDays)} أيام ${planLabel(REF_RULES.plan)} فور تفعيله، وتحصل أنت على ${nf(REF_RULES.inviterDays)} أيام بعد أن يجرّب التطبيق (يرسل ${nf(REF_RULES.minMsgs)} رسائل). كلما دعوت أكثر ربحت أكثر، حتى ${nf(REF_RULES.maxRewards)} صديقًا.`;
  const box = $('planRefBox'); box.hidden = !(logged && r && r.code);
  $('planRefMsg').textContent = logged ? '' : 'سجّل الدخول بحساب Google لتحصل على كود إحالتك.';
  if (box.hidden) return;
  $('planRefCode').textContent = r.code;
  $('planRefStats').innerHTML = `<div><b>${nf(r.rewarded || 0)}</b><small>دعوة مكتملة</small></div><div><b>${nf(r.pending || 0)}</b><small>بانتظار التجربة</small></div><div><b>${nf(r.daysEarned || 0)}</b><small>يوم ربحتها</small></div>`;
}
$('planRefCopy').addEventListener('click', async () => {
  const c = refCache && refCache.code; if (!c) return;
  const ok = await copyText(c);
  $('planRefMsg').textContent = ok ? 'تم نسخ الكود.' : 'تعذّر النسخ.'; $('planRefMsg').className = 'plan-msg' + (ok ? ' ok' : ' err');
});
$('planRefShare').addEventListener('click', async () => {
  const c = refCache && refCache.code; if (!c) return;
  const text = refShareText(c);
  try{ if (navigator.share){ await navigator.share({ text }); return; } }catch(e){ if (e && e.name === 'AbortError') return; }
  const ok = await copyText(text);
  $('planRefMsg').textContent = ok ? 'نُسخت رسالة الدعوة، الصقها لصديقك.' : 'تعذّرت المشاركة.'; $('planRefMsg').className = 'plan-msg' + (ok ? ' ok' : ' err');
});

/* ---------- فتح/إغلاق ---------- */
function openPlans(reason){
  renderPlan(); loadPlans().then(ok => { if (ok) renderPlan(); }); syncSub().then(ok => { if (ok) renderPlan(); });
  const r = $('planReason'); r.hidden = !reason; r.textContent = reason || '';
  $('planMsg').textContent = ''; $('planMsg').className = 'plan-msg';
  $('planOv').hidden = false; $('planOv').scrollTop = 0;
}
const closePlans = () => { $('planOv').hidden = true; };
$('upBtn').addEventListener('click', () => openPlans());
$('planX').addEventListener('click', closePlans);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('planOv').hidden){ e.stopImmediatePropagation(); closePlans(); } }, true);

/* ---------- تفعيل الكود (اشتراك / إحالة / ترويجي) ---------- */
$('planCode').addEventListener('input', e => {
  const c = normCode(e.target.value).slice(0, 16);
  e.target.value = prettyCode(c);
  $('planGo').disabled = !validCodeLen(c); $('planMsg').textContent = ''; $('planMsg').className = 'plan-msg';
});
function okText(r){
  if (r.kind === 'ref') return `تم! حصلت على ${r.label} ${planLabel(r.plan)} مجانًا بفضل دعوة صديقك 🎉`;
  if (r.kind === 'promo') return `تم تفعيل الكود — أُضيفت ${r.label} إلى حسابك 🎉`;
  if (r.exp === null) return `تم التفعيل بنجاح — ${planLabel(r.plan)} مدى الحياة 🎉`;
  return r.upgraded ? `تمت الترقية إلى ${planLabel(r.plan)} بنجاح 🎉` : `تم التفعيل بنجاح — أُضيف ${r.label} إلى ${planLabel(r.plan)} 🎉`;
}
async function doRedeem(){
  const m = $('planMsg'), btn = $('planGo'); btn.disabled = true; m.textContent = 'جارٍ التحقق…'; m.className = 'plan-msg';
  const r = await redeemCode($('planCode').value);
  btn.disabled = !validCodeLen(normCode($('planCode').value));
  if (!r.ok){ m.textContent = r.msg; m.className = 'plan-msg err'; return; }
  m.textContent = okText(r); m.className = 'plan-msg ok';
  $('planCode').value = ''; $('planGo').disabled = true;
  renderPlan(); applyTheme(); renderMessages();
}
$('planGo').addEventListener('click', doRedeem);
$('planCode').addEventListener('keydown', e => { if (e.key === 'Enter' && !$('planGo').disabled){ e.preventDefault(); doRedeem(); } });
$('planRemove').addEventListener('click', async () => {
  if (!await qConfirm('إزالة الاشتراك من هذا الجهاز؟ ستعود قيود الخطة المجانية.', { ok:'إزالة' })) return;
  store.set('ai_sub', null); renderPlan(); applyTheme(); renderMessages();
  $('planMsg').textContent = 'أُزيل الاشتراك.'; $('planMsg').className = 'plan-msg';
});
renderPlan(); loadPlans().then(ok => { if (ok) renderPlan(); }); syncSub().then(ok => { if (ok) renderPlan(); });
