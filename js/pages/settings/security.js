/* QUARK AI — تبويب الأمان */
'use strict';

/* ----- تبويب الأمان ----- */
function renderSecurity(){
  const on = hasLock();
  $('secSet').hidden = on; $('secChange').hidden = !on; $('secRemove').hidden = !on;
  $('secState').textContent = on ? 'مفعّل' : 'غير مفعّل';
  $('secDelayBox').hidden = !on; $('secDelay').value = String(lockDelay());
}
$('secDelay').addEventListener('change', e => { store.set('ai_lock_delay', Number(e.target.value)); toast('تم حفظ مدة القفل'); });
$('secSet').addEventListener('click', async () => {
  const pin = await pinCreate(); pinClose();
  if (pin){ setPin(pin); toast('تم تعيين رمز الأمان'); }
  renderSecurity();
});
$('secChange').addEventListener('click', async () => {
  if (!await verifyCurrent({ title:'الرمز الحالي', sub:'أدخل رمزك الحالي للمتابعة', cancellable:true })){ pinClose(); return; }
  const pin = await pinCreate(); pinClose();
  if (pin){ setPin(pin); toast('تم تغيير رمز الأمان'); }
  renderSecurity();
});
$('secRemove').addEventListener('click', async () => {
  const ok = await verifyCurrent({ title:'إزالة الرمز', sub:'أدخل رمزك الحالي للتأكيد', cancellable:true });
  pinClose();
  if (ok){ store.remove('ai_lock'); toast('تمت إزالة رمز الأمان'); }
  renderSecurity();
});

