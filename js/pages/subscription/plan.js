/* QUARK AI — صفحة الاشتراك */
'use strict';

/* ----- صفحة الاشتراك ----- */
function fmtDate(t){ try{ return new Date(t).toLocaleDateString('ar', { year:'numeric', month:'long', day:'numeric' }); }catch{ return new Date(t).toDateString(); } }
function renderPlan(){
  const pro = isPro(), s = getSub();
  $('planProTag').hidden = !pro; $('planFreeTag').hidden = pro;
  $('planStatus').hidden = !pro;
  if (pro) $('planStatus').textContent = s.exp === null ? 'اشتراكك في برو فعّال مدى الحياة.' : 'اشتراكك في برو فعّال حتى ' + fmtDate(s.exp) + '.';
  $('planGo').textContent = pro ? 'تمديد الاشتراك' : 'تفعيل برو';
  $('planCodeLbl').textContent = pro ? 'كود لتمديد الاشتراك' : 'كود التفعيل';
  $('planRemove').hidden = !pro;
  $('upTitle').textContent = pro ? 'أنت مشترك في برو' : 'تريد المزيد؟';
  $('upText').textContent = pro ? (s.exp === null ? 'اشتراكك فعّال مدى الحياة.' : 'اشتراكك فعّال حتى ' + fmtDate(s.exp) + '.') : 'رقّ إلى برو للحصول على ثيمات مخصصة بلا حدود ونمط الحاوية للرسائل.';
  $('upBtn').textContent = pro ? 'إدارة الاشتراك' : 'ترقية';
}
function openPlans(reason){
  renderPlan();
  const r = $('planReason'); r.hidden = !reason; r.textContent = reason || '';
  $('planMsg').textContent = ''; $('planMsg').className = 'plan-msg';
  $('planOv').hidden = false; $('planOv').scrollTop = 0;
}
const closePlans = () => { $('planOv').hidden = true; };
$('upBtn').addEventListener('click', () => openPlans());
$('planX').addEventListener('click', closePlans);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('planOv').hidden){ e.stopImmediatePropagation(); closePlans(); } }, true);
$('planCode').addEventListener('input', e => {
  const c = normCode(e.target.value).slice(0, 8);
  e.target.value = c.length > 4 ? c.slice(0, 4) + '-' + c.slice(4) : c;
  $('planGo').disabled = c.length !== 8; $('planMsg').textContent = ''; $('planMsg').className = 'plan-msg';
});
function doRedeem(){
  const m = $('planMsg'), r = redeemCode($('planCode').value);
  if (!r.ok){ m.textContent = r.msg; m.className = 'plan-msg err'; return; }
  m.textContent = r.exp === null ? 'تم التفعيل بنجاح — اشتراك مدى الحياة 🎉' : 'تم التفعيل بنجاح — أُضيف ' + r.label + ' إلى اشتراكك 🎉';
  m.className = 'plan-msg ok';
  $('planCode').value = ''; $('planGo').disabled = true;
  renderPlan(); applyTheme(); renderMessages();
}
$('planGo').addEventListener('click', doRedeem);
$('planCode').addEventListener('keydown', e => { if (e.key === 'Enter' && !$('planGo').disabled){ e.preventDefault(); doRedeem(); } });
$('planRemove').addEventListener('click', async () => {
  if (!await qConfirm('إزالة اشتراك برو من هذا الجهاز؟ ستعود قيود الخطة المجانية.', { ok:'إزالة' })) return;
  store.set('ai_sub', null); renderPlan(); applyTheme(); renderMessages();
  $('planMsg').textContent = 'أُزيل الاشتراك.'; $('planMsg').className = 'plan-msg';
});
renderPlan();
