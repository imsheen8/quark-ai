/* QUARK AI — تبويبات الإعدادات وفتح/إغلاق الصفحة */
'use strict';

let curSetTab = 'keys';
/* الاهتزاز: يظهر الخيار داخل التطبيق فقط ويُحفظ فورًا */
$('hapticsRow').style.display = (window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform()) ? '' : 'none';
$('hapticsSw').checked = store.get('ai_haptics', true) !== false;
$('hapticsSw').addEventListener('change', e => { store.set('ai_haptics', e.target.checked); toast(e.target.checked ? 'تم تفعيل الاهتزاز' : 'تم إيقاف الاهتزاز'); });
$('introSw').checked = introOn();
$('introSw').addEventListener('change', e => { store.set('ai_intro', e.target.checked); toast(e.target.checked ? 'تم تفعيل انميشن الدخول' : 'تم إيقاف انميشن الدخول'); });
$('widgetBtn').addEventListener('click', () => window.pinQuarkWidget?.());
$('tileBtn').addEventListener('click', () => window.addQuarkTile?.());
$('autoTitleSw').checked = settings.autoTitle;
$('autoTitleSw').addEventListener('change', e => { settings.autoTitle = e.target.checked; persistSettings(); toast(settings.autoTitle ? 'تم تفعيل العنوان التلقائي' : 'تم إيقاف العنوان التلقائي'); });
const phone = () => true; /* الواجهة الجديدة (قائمة ثم تفاصيل) لكل الأحجام */
const SET_TITLES = { keys:'المفاتيح والنماذج', defaults:'النماذج التلقائية', research:'البحث العميق', integrations:'التكاملات', agent:'الوكيل', custom:'التخصيص', general:'عام', voice:'الصوت', look:'المظهر', security:'الأمان', stats:'الإحصائيات', data:'التخزين', about:'حول التطبيق' };
function selectTab(name){
  if (name === 'tasks'){ window.__openTasks?.('act'); return; }   /* رابط قديم: المهام صارت في المكتبة */
  if (name === 'home' && !phone()) name = 'keys';
  curSetTab = name;
  const home = name === 'home';
  $('modal').dataset.view = home ? 'home' : 'detail'; $('modal').dataset.tab = name;
  $('setTitle').textContent = phone() && !home ? SET_TITLES[name] : 'الإعدادات';
  $('shPop').hidden = true;
  if (home) renderSetHome();
  $('tabs').querySelectorAll('button').forEach(b => { const on = b.dataset.tab === name; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  document.querySelectorAll('.tab-panel').forEach(p => { p.hidden = home || p.dataset.panel !== name; });
  if (name === 'data') renderStats();
  if (name === 'stats') window.__stOpen?.();
  if (name === 'security') renderSecurity();
  if (name === 'voice') renderVoice();
  if (name === 'keys') window.renderKeysVoice?.();
  if (name === 'defaults') window.renderDefs?.();
  if (name === 'research') window.renderRsSet?.();
  if (name === 'integrations') window.renderInt?.();
  if (name === 'agent') window.renderAgent?.();
  if (name === 'custom'){ window.__mmRefresh?.(); window.__renderSkillSettings?.(); $('pfPrefs').value = getProfile().prefs; $('pfSystem').value = settings.systemPrompt; pfDirty(); renderPrm(); }
  window.__syncHash?.();
  el.modal.querySelector('.set-body').scrollTop = 0; $('setHome').scrollTop = 0;
}
function openSettings(tab = 'keys'){
  draft = { endpoints: JSON.parse(JSON.stringify(settings.endpoints)) };
  openEps.clear(); tested = null; fKey.value = '';
  applyPreset(fPreset.value && PRESETS[fPreset.value] ? fPreset.value : 'openrouter');
  renderEps(); syncLook(); selectTab(tab);
  mainEl.classList.remove('lib-open','pf-open','ch-open','md-open','vo-open'); mainEl.classList.add('set-open'); closeDrawer();
}
const closeSettings = () => { mainEl.classList.remove('set-open'); };

$('tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) selectTab(b.dataset.tab); });
$('saveSettings').addEventListener('click', () => {
  settings.endpoints = draft.endpoints;
  const ep = settings.sel && epOf(settings.sel.ep);
  if (!ep || !ep.enabled) settings.sel = null;
  if (!settings.sel){
    for (const e of settings.endpoints){
      if (!e.enabled) continue;
      const m = e.models.find(x => x.on);
      if (m){ settings.sel = { ep:e.id, model:m.id }; break; }
    }
  }
  persistSettings(); phone() ? selectTab('home') : closeSettings(); updateModelLabels(); toast('تم حفظ الإعدادات');
});
$('avatarBtn').addEventListener('click', () => openSettings('home'));
$('setBack').addEventListener('click', () => selectTab('home'));
$('cancelSettings').addEventListener('click', closeSettings);
$('setMenu').addEventListener('click', () => $('toggleSidebar').click());


/* ================= الصفحة الرئيسية للإعدادات على الهاتف (قائمة مجموعات) ================= */
const shIcon = n => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
function shRow(go, icon, title, sub, cls = ''){
  return `<button type="button" class="sh-row ${cls}" data-go="${go}">${shIcon(icon)}<span class="sh-t"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span></button>`;
}
function shSwitch(id, icon, title, on){
  return `<button type="button" class="sh-row" role="switch" aria-checked="${on}" data-sw="${id}">${shIcon(icon)}<span class="sh-t"><b>${esc(title)}</b></span><i class="sh-tg"></i></button>`;
}
function renderSetHome(){
  const pf = getProfile(), pro = isPro();
  const eps = settings.endpoints.filter(e => e.enabled).length;
  const theme = { auto:'تلقائي', light:'فاتح', dark:'داكن' }[settings.theme] || 'مخصص';
  const font = { sm:'صغير', md:'متوسط', lg:'كبير' }[settings.fontSize] || 'متوسط';
  const voiceOn = !!(voiceConf('stt').key || voiceConf('tts').key);
  const nChats = (typeof chats !== 'undefined' ? chats.filter(c => !c.temp).length : 0);
  let h = `<button type="button" class="sh-card sh-acc" data-go="profile"><span class="sh-name">${esc(pf.nick || pf.name || 'حسابي')}</span><span class="sh-badge">${pro ? 'برو' : 'مجاني'}</span></button>`;
  if (!pro) h += `<div class="sh-card sh-up"><h3>تريد المزيد؟</h3><p>رقِّ حسابك للحصول على استخدام وإمكانيات أكثر.</p><button type="button" class="sh-upbtn" data-go="plan">ترقية</button></div>`;
  h += `<div class="sh-grp">${shRow('profile','sh-user','الملف الشخصي','')}${shRow('plan','sh-dollar','الاشتراك','')}</div>`;
  h += `<div class="sh-grp">${shRow('keys','sh-blocks','المفاتيح والنماذج', eps ? `${eps} مفعّلة` : 'أضف مفتاحًا للبدء')}${shRow('defaults','cpu','النماذج التلقائية', window.__defSub ? window.__defSub() : '')}${shRow('research','globe','البحث العميق', window.__rsSub ? window.__rsSub() : '')}${shRow('integrations','plug','التكاملات', window.__intSub ? window.__intSub() : '')}${shRow('agent','sparkles','الوكيل', window.__agSub ? window.__agSub() : '')}${shRow('custom','sh-aa','التخصيص','الذاكرة والمهارات والتعليمات ومعاملات النموذج')}${shRow('security','sh-shield','الأمان', hasLock() ? 'مفعّل' : 'غير مفعّل')}</div>`;
  h += `<div class="sh-grp">${shRow('general','sh-sliders','عام', 'العنوان التلقائي والاهتزاز')}${shRow('look','moon','المظهر', `${theme} · ${font}`)}${shRow('voice','sh-wave','الصوت', voiceOn ? 'مفعّل' : 'غير مضبوط')}${shRow('mail','mail','البريد', window.__mlSub ? window.__mlSub() : '')}${shRow('stats','chart','الإحصائيات', window.__stSub ? window.__stSub() : 'النص والصوت والنماذج')}${shRow('data','database','التخزين والنسخ الاحتياطي', `${nChats} محادثة`)}</div>`;
  h += `<div class="sh-grp">${shRow('reset','refresh','مسح المفاتيح وإعادة الضبط','', 'danger')}</div>`;
  $('setHome').innerHTML = h;
  $('shPop').innerHTML = `<a class="sh-pi" href="https://discord.gg/ycmPBVszCy" target="_blank" rel="noopener noreferrer">${shIcon('globe')}<span>ديسكورد</span></a>` +
    `<button type="button" class="sh-pi" data-go="about">${shIcon('info')}<span>حول التطبيق</span></button><div class="sh-ver" dir="ltr">Version 1.0</div>`;
}
$('setHome').addEventListener('click', e => {
  const b = e.target.closest('[data-go]'); if (!b) return;
  const g = b.dataset.go;
  if (g === 'profile') openProfile();
  else if (g === 'plan') openPlans();
  else if (g === 'reset') $('resetAll').click();
  else if (g === 'mail'){ window.__openMail?.(); window.mlShowSettings?.(true); }
  else selectTab(g);
});
$('setInfo').addEventListener('click', e => { e.stopPropagation(); $('shPop').hidden = !$('shPop').hidden; });
$('shPop').addEventListener('click', e => { const b = e.target.closest('[data-go]'); $('shPop').hidden = true; if (b) selectTab(b.dataset.go); });
document.addEventListener('click', e => { if (!$('shPop').hidden && !e.target.closest('#shPop,#setInfo')) $('shPop').hidden = true; });
