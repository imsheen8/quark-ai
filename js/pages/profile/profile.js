/* QUARK AI — الملف الشخصي */
'use strict';

/* ----- الملف الشخصي ----- */
const getProfile = () => ({ name:'', nick:'', photo:'', prefs:'', ...store.get('ai_profile', {}) });
const setProfile = o => store.set('ai_profile', o);
const initialOf = pf => ((pf.nick || pf.name || '').trim()[0] || '').toUpperCase();
function avatarHTML(pf){
  if (pf.photo) return `<img src="${pf.photo}" alt="">`;
  const c = initialOf(pf); return c ? c : ic('user');
}
function renderAvatars(){
  const pf = getProfile(), h = avatarHTML(pf);
  $('avatarBtn').innerHTML = h; $('pfAva').innerHTML = h; $('pfPhotoRm').hidden = !pf.photo;
}
function pfDirty(){
  const pf = getProfile();
  $('pfUpdate').disabled = $('pfName').value.trim() === pf.name && $('pfNick').value.trim() === pf.nick;
  $('pfSavePrefs').disabled = $('pfPrefs').value.trim() === pf.prefs;
  $('pfSaveSystem').disabled = $('pfSystem').value.trim() === settings.systemPrompt;
}
function openProfile(){
  const pf = getProfile();
  $('pfDelAcc').hidden = !(window.QuarkAuth && QuarkAuth.session());
  $('pfName').value = pf.name; $('pfNick').value = pf.nick;
  renderAvatars(); pfDirty();
  mainEl.classList.remove('lib-open','set-open','ch-open','md-open','vo-open'); mainEl.classList.add('pf-open');
  $('pfView').querySelector('.set-body').scrollTop = 0; closeDrawer();
}
const closeProfile = () => { mainEl.classList.remove('pf-open'); };
$('pfBack').addEventListener('click', () => openSettings('home'));
['pfName','pfNick','pfPrefs','pfSystem'].forEach(id => $(id).addEventListener('input', pfDirty));
$('pfUpdate').addEventListener('click', () => {
  const pf = getProfile(); pf.name = $('pfName').value.trim(); pf.nick = $('pfNick').value.trim();
  setProfile(pf); renderAvatars(); pfDirty(); toast('تم تحديث الملف الشخصي');
});
$('pfSavePrefs').addEventListener('click', () => {
  const pf = getProfile(); pf.prefs = $('pfPrefs').value.trim();
  setProfile(pf); pfDirty(); toast('تم حفظ التفضيلات');
});
$('pfSaveSystem').addEventListener('click', () => {
  settings.systemPrompt = $('pfSystem').value.trim(); persistSettings(); pfDirty(); toast('تم حفظ تعليمات النظام');
});
$('pfPhotoBtn').addEventListener('click', () => $('pfFile').click());
$('pfPhotoRm').addEventListener('click', () => { const pf = getProfile(); pf.photo = ''; pf.photoSrc = ''; setProfile(pf); renderAvatars(); toast('تمت إزالة الصورة'); });
$('pfFile').addEventListener('change', e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const img = new Image(), url = URL.createObjectURL(f);
  img.onload = () => {
    const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
    const m = Math.min(img.width, img.height), sx = (img.width - m) / 2, sy = (img.height - m) / 2;
    c.getContext('2d').drawImage(img, sx, sy, m, m, 0, 0, S, S); URL.revokeObjectURL(url);
    const pf = getProfile(); pf.photo = c.toDataURL('image/jpeg', .85); pf.photoSrc = ''; setProfile(pf); renderAvatars(); toast('تم تحديث الصورة');
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('تعذّر قراءة الصورة'); };
  img.src = url;
});
$('pfGoSettings').addEventListener('click', () => openSettings());
$('pfLogout').addEventListener('click', async () => {
  if (typeof busy !== 'undefined' && busy){ toast('انتظر انتهاء الرد الحالي'); return; }
  const google = !!(window.QuarkAuth && QuarkAuth.session());
  if (!await qConfirm(google ? 'تسجيل الخروج من حسابك؟ تُحفظ بياناتك في حسابك السحابي ويمكنك الدخول بها لاحقًا.' : 'تسجيل الخروج من هذا الحساب؟ تبقى بياناتك على الجهاز ويمكنك الدخول ببريدك وكلمة مرورك.', { ok:'تسجيل الخروج' })) return;
  if (google){ await QuarkCloud.logout(); return; }
  store.set('ai_onboarded', false); await QuarkKV.flush(); location.reload();
});
$('pfDelAcc').addEventListener('click', async () => {
  if (typeof busy !== 'undefined' && busy){ toast('انتظر انتهاء الرد الحالي'); return; }
  if (!await qConfirm('سيُحذف حسابك نهائيًا: نسختك السحابية واشتراكك (إن وُجد) وكل المحادثات والإعدادات والمفاتيح على هذا الجهاز. لا يمكن التراجع، ولن يُعاد الاشتراك. هل أنت متأكد؟', { ok:'متابعة' })) return;
  if (!await qConfirm('تأكيد أخير: حذف الحساب وكل بياناتك نهائيًا؟', { ok:'نعم، احذف كل شيء' })) return;
  const r = await QuarkCloud.deleteAccount();
  if (!r.ok) toast(r.msg);
});
$('pfDelAll').addEventListener('click', () => $('delAll').click());
renderAvatars();

