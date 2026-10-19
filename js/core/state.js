/* QUARK AI — حالة التطبيق: المحادثات، الحفظ، التنبيهات */
'use strict';

const effStyle = () => 'plain';   /* نمط الرسائل «عادية» فقط — أُزيل خيار الحاوية */
const revealedMsgs = new WeakSet();
const QUICK = [['اشرح أكثر', 'اشرح لي ذلك بتفصيل أوسع.'], ['لخّص', 'لخّص ردك السابق في نقاط قصيرة.'], ['ترجم', 'ترجم ردك السابق إلى الإنجليزية.'], ['أعطني مثالًا', 'أعطني مثالًا عمليًا على ذلك.']];
settings.themeSel = { dark:'default', light:'default', ...(settings.themeSel && typeof settings.themeSel === 'object' ? settings.themeSel : {}) };
settings.customThemes = (Array.isArray(settings.customThemes) ? settings.customThemes : []).filter(t => t && t.id && /^#[0-9a-f]{6}$/i.test(t.bg) && /^#[0-9a-f]{6}$/i.test(t.surface) && /^#[0-9a-f]{6}$/i.test(t.text) && /^#[0-9a-f]{6}$/i.test(t.accent) && (t.mode === 'dark' || t.mode === 'light')).slice(0, 50);
settings.params = { global:{ ...(settings.params?.global || {}) }, models:{ ...(settings.params?.models || {}) } };
const persistSettings = () => store.set('ai_settings_v3', { endpoints:settings.endpoints, sel:settings.sel, theme:settings.theme, fontSize:settings.fontSize, systemPrompt:settings.systemPrompt, autoTitle:settings.autoTitle, params:settings.params, themeSel:settings.themeSel, customThemes:settings.customThemes, msgStyle:settings.msgStyle, cont:settings.cont, gw:settings.gw, research:settings.research, skills:settings.skills, memory:settings.memory, defs:settings.defs });
const hostOf = u => { if (/^ondevice:/.test(u || '')) return 'على الجهاز'; if (typeof MANAGED_URL !== 'undefined' && MANAGED_URL && String(u || '').replace(/\/+$/, '') === MANAGED_URL) return 'QUARK'; try{ return new URL(u).host; }catch{ return u || '—'; } };
const epOf = id => settings.endpoints.find(e => e.id === id);
function activeModel(){
  const s = settings.sel, ep = s && epOf(s.ep);
  return ep && ep.enabled && s.model ? { ep, model:s.model } : null;
}


let chats = store.get('ai_chats', []);
let currentId = null; /* يبدأ التطبيق دائمًا من الشاشة الرئيسية */
let incog = false; /* وضع المحادثة الخفية: لا تُحفظ ولا تظهر في السجل */
let pending = [];
let controller = null, busy = false, query = '', showAll = false;
let cmpState = store.get('ai_cmp', { on:false, sel:null }), popTarget = 'A';
const saveCmp = () => store.set('ai_cmp', cmpState);
const uid = () => { const a = new Uint8Array(10); crypto.getRandomValues(a); return Array.from(a, x => 'abcdefghijklmnopqrstuvwxyz0123456789'[x % 36]).join(''); };
const current = () => chats.find(c => c.id === currentId);
const save = () => {
  const cur = current();
  /* الانتقال إلى محادثة عادية يُسقط أي محادثة خفية ويُنهي الوضع */
  if (cur && !cur.temp){ if (chats.some(c => c.temp)) chats = chats.filter(c => !c.temp); incog = false; }
  store.set('ai_chats', chats.filter(c => !c.temp));
  store.set('ai_current', cur && cur.temp ? null : currentId);
  window.__syncHash?.(); queueGc();
};

let toastT;
function toast(msg){
  el.toast.textContent = msg; el.toast.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.toast.classList.remove('show'), 2600);
}
const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const shortModel = m => (m || '').split('/').pop() || '—';

