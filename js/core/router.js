/* QUARK AI — الروابط (Router) */
'use strict';

/* ================= الروابط (Router) ================= */
const SETTINGS_TABS = () => ['home', ...$('tabs').querySelectorAll('[data-tab]')].map(b => typeof b === 'string' ? b : b.dataset.tab);
const PAGE_NAMES = { library:'المكتبة', settings:'الإعدادات', profile:'الملف الشخصي', chats:'المحادثات', models:'النماذج', voices:'الأصوات', research:'البحث العميق', tasks:'المهام', skills:'المهارات', memory:'الذاكرة', mail:'البريد' };
let routerReady = false, syncQueued = false;
const viewOf = () => mainEl.classList.contains('set-open') ? 'settings' : mainEl.classList.contains('ml-open') ? 'mail' : mainEl.classList.contains('lib-open') ? 'library' : mainEl.classList.contains('pf-open') ? 'profile' : mainEl.classList.contains('ch-open') ? 'chats' : mainEl.classList.contains('md-open') ? 'models' : mainEl.classList.contains('vo-open') ? 'voices' : 'chat';
function computeHash(){
  const v = viewOf();
  if (v === 'settings') return '#/settings/' + curSetTab;
  if (v === 'library'){ const t = window.__libTab?.() || 'all', sb = t === 'tasks' ? window.__tkSubName?.() : ''; return '#/library' + (t === 'all' ? '' : '/' + t) + (sb && sb !== 'list' ? '/' + sb : ''); }
  if (v === 'profile') return '#/profile';
  if (v === 'chats') return '#/chats';
  if (v === 'models') return '#/models';
  if (v === 'voices') return '#/voices';
  if (v === 'mail') return '#/mail';
  return currentId && !current()?.temp ? '#/c/' + encodeURIComponent(currentId) : '#/';
}
const chatUrl = id => location.href.split('#')[0] + '#/c/' + encodeURIComponent(id);
function setHash(h, replace){
  if (location.hash === h) return;
  if (replace){ try{ history.replaceState(null, '', h); return; }catch{} }
  location.hash = h;
}
function syncTitle(){
  const v = viewOf(), c = current();
  document.title = v === 'chat' ? (c && c.messages.length ? c.title + ' — QUARK AI' : 'QUARK AI') : PAGE_NAMES[v] + ' — QUARK AI';
}
function syncHash(replace){
  if (!routerReady) return;
  if (syncQueued && !replace) return;
  syncQueued = true;
  Promise.resolve().then(() => { syncQueued = false; setHash(computeHash(), replace === true); syncTitle(); });
}
window.__syncHash = syncHash;
function showChatView(){ window.__closeTasks?.(false); mainEl.classList.remove('lib-open','set-open','pf-open','ch-open','md-open','vo-open','tk-open','sk-open','mm-open','ml-open'); }
function applyRoute(){
  if (location.hash === computeHash()) return;
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(x => { try{ return decodeURIComponent(x); }catch{ return x; } });
  const [page, arg, arg2] = parts;
  if (!page){ if (viewOf() === 'chat' && currentId === null) return; if (busy){ syncHash(true); return; } showChatView(); currentId = null; save(); renderAll(); return; }
  if (page === 'c' && arg){
    const c = chats.find(x => x.id === arg);
    if (!c){ toast('هذه المحادثة غير موجودة على هذا الجهاز'); syncHash(true); return; }
    if (c.id !== currentId && busy){ syncHash(true); return; }
    if (viewOf() === 'chat' && c.id === currentId) return;
    showChatView(); currentId = c.id; save(); renderAll(); syncTitle(); return;
  }
  if (page === 'mail'){ if (viewOf() !== 'mail') window.__openMail(); return; }
  if (page === 'memory'){ window.__openMemory(); syncHash(true); return; }
  if (page === 'skills'){ window.__openSkills(); syncHash(true); return; }
  if (page === 'tasks'){ window.__openTasks(arg || 'list'); syncHash(true); return; }
  if (page === 'research'){ window.__libSetTab?.('research'); window.__openLib?.(); return; }   /* رابط قديم: السجل صار في المكتبة */
  if (page === 'voices'){ if (viewOf() !== 'voices') window.__openVoices(); return; }
  if (page === 'models'){ if (viewOf() !== 'models') openModels(); return; }
  if (page === 'chats'){ if (viewOf() !== 'chats') openChats(); return; }
  if (page === 'library'){
    if (arg === 'results'){ window.__openTasks('results'); syncHash(true); return; }   /* رابط قديم: النتائج صارت قسمًا داخل المهام */
    const t = window.__libTabs?.includes(arg) ? arg : 'all';
    if (t === 'tasks') window.__tkSetSub?.(['results', 'act'].includes(arg2) ? arg2 : 'list');
    window.__libSetTab?.(t); window.__openLib?.(); return;
  }
  if (page === 'settings'){
    if (arg === 'tasks'){ window.__openTasks('act'); syncHash(true); return; }   /* رابط قديم: النشاط صار قسمًا داخل المهام */
    const t = SETTINGS_TABS().includes(arg) ? arg : 'home';
    if (viewOf() === 'settings'){ selectTab(t); syncHash(); } else openSettings(t);
    return;
  }
  if (page === 'profile'){ if (viewOf() !== 'profile') openProfile(); return; }
  syncHash(true);
}
window.addEventListener('hashchange', () => { if (routerReady && $('gate').hidden && pinOv.hidden) applyRoute(); });
new MutationObserver(() => syncHash()).observe(mainEl, { attributes:true, attributeFilter:['class'] });

async function boot(){
  if (window.QuarkAuth && QuarkAuth.needed()) await QuarkAuth.gate();   /* الدخول بحساب Google قبل أي شيء */
  try{ if (window.QuarkAuth && QuarkAuth.session()) await Promise.race([syncSub(), new Promise(r => setTimeout(r, 3500))]); }catch{}   /* حالة برو من الخادم */
  if (window.QuarkCloud) await QuarkCloud.boot();   /* استعادة بيانات الحساب السحابية إن وُجدت */
  if (!store.get('ai_onboarded', false)) await runGate();   /* أول فتح: المقدمة الكاملة + إنشاء الحساب */
  else {
    if (introOn()) await QuarkIntro.playLogo(); else QuarkIntro.uncover();   /* الشعار فقط (قابل للإيقاف من الإعدادات) */
    if (hasLock()) await lockNow();
  }
  routerReady = true;
  if (location.hash.replace('#', '') === '') { syncHash(true); syncTitle(); } else applyRoute();
}

