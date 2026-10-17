/* QUARK AI — الإعدادات الافتراضية والتخزين المحلي (PRESETS, store, settings) */
'use strict';

/* ================= الإعدادات ================= */
const PRESETS = {
  openrouter:{ label:'OpenRouter', url:'https://openrouter.ai/api/v1', proto:'openai', kind:'api',
    help:'احصل على مفتاح من <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a>.' },
  openai:{ label:'OpenAI', url:'https://api.openai.com/v1', proto:'openai', kind:'api',
    help:'مفتاح من <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com</a>.' },
  anthropic:{ label:'Anthropic', url:'https://api.anthropic.com/v1', proto:'anthropic', kind:'api',
    help:'مفتاح من <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a>.' },
  deepseek:{ label:'DeepSeek', url:'https://api.deepseek.com/v1', proto:'openai', kind:'api',
    help:'مفتاح من <a href="https://platform.deepseek.com" target="_blank" rel="noopener">platform.deepseek.com</a>.' },
  gemini:{ label:'Google Gemini', url:'https://generativelanguage.googleapis.com/v1beta/openai', proto:'openai', kind:'api',
    help:'مفتاح من <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com</a>.' },
  groq:{ label:'Groq', url:'https://api.groq.com/openai/v1', proto:'openai', kind:'api',
    help:'مفتاح من <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com</a>.' },
  ollama:{ label:'Ollama', url:'http://localhost:11434/v1', proto:'openai', kind:'local',
    help:'لا يحتاج مفتاحًا. إن كان على جهاز آخر غيّر العنوان، وشغّل Ollama مع OLLAMA_ORIGINS=* للسماح للمتصفح.' },
  lmstudio:{ label:'LM Studio', url:'http://localhost:1234/v1', proto:'openai', kind:'local',
    help:'لا يحتاج مفتاحًا. فعّل خيار CORS من إعدادات الخادم المحلي.' },
  mistral:{ label:'Mistral', url:'https://api.mistral.ai/v1', proto:'openai', kind:'api',
    help:'مفتاح من <a href="https://console.mistral.ai/api-keys" target="_blank" rel="noopener">console.mistral.ai</a>.' },
  xai:{ label:'xAI (Grok)', url:'https://api.x.ai/v1', proto:'openai', kind:'api',
    help:'مفتاح من <a href="https://console.x.ai" target="_blank" rel="noopener">console.x.ai</a>.' },
  together:{ label:'Together', url:'https://api.together.xyz/v1', proto:'openai', kind:'api',
    help:'مفتاح من <a href="https://api.together.ai/settings/api-keys" target="_blank" rel="noopener">api.together.ai</a>.' },
  fireworks:{ label:'Fireworks', url:'https://api.fireworks.ai/inference/v1', proto:'openai', kind:'api',
    help:'مفتاح من <a href="https://fireworks.ai/account/api-keys" target="_blank" rel="noopener">fireworks.ai</a>.' },
  cerebras:{ label:'Cerebras', url:'https://api.cerebras.ai/v1', proto:'openai', kind:'api',
    help:'مفتاح من <a href="https://cloud.cerebras.ai" target="_blank" rel="noopener">cloud.cerebras.ai</a>.' },
  nvidia:{ label:'NVIDIA NIM', url:'https://integrate.api.nvidia.com/v1', proto:'openai', kind:'api',
    help:'مفتاح من <a href="https://build.nvidia.com" target="_blank" rel="noopener">build.nvidia.com</a>.' },
  moonshot:{ label:'Moonshot (Kimi)', url:'https://api.moonshot.ai/v1', proto:'openai', kind:'api',
    help:'مفتاح من <a href="https://platform.moonshot.ai" target="_blank" rel="noopener">platform.moonshot.ai</a>.' },
  siliconflow:{ label:'SiliconFlow', url:'https://api.siliconflow.com/v1', proto:'openai', kind:'api',
    help:'مفتاح من <a href="https://cloud.siliconflow.com" target="_blank" rel="noopener">cloud.siliconflow.com</a>.' },
  gemini_native:{ label:'Gemini — أصلي (بوابة)', url:'https://generativelanguage.googleapis.com/v1beta', proto:'gemini', kind:'api',
    help:'الصيغة الأصلية: تُظهر «تفكير» Gemini وتدعم توليد الصور. <b>تتطلب تشغيل البوابة.</b> المفتاح من <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com</a>.' },
  ollama_native:{ label:'Ollama — أصلي (بوابة)', url:'http://localhost:11434', proto:'ollama', kind:'local',
    help:'الصيغة الأصلية: تكتشف قدرات كل نموذج وتضبط نافذة السياق، ولا تحتاج إعداد CORS. <b>تتطلب تشغيل البوابة</b> على الجهاز الذي يصل إلى Ollama.' },
  custom:{ label:'مخصص', url:'', proto:'openai', kind:'api', help:'أي خدمة متوافقة مع OpenAI أو Anthropic — اكتب العنوان الأساسي مع /v1. مع البوابة تُكتشف الصيغة من العنوان تلقائيًا.' },
};
const DEFAULT_SYSTEM = 'أنت مساعد ذكي ودود. أجب بنفس لغة المستخدم بوضوح وإيجاز، واستخدم التنسيق عند الحاجة.';

/* التخزين: بايثون هو المصدر (SQLite + ملفات) عبر QuarkKV، ويعود للمتصفح إن لم يوجد خادم — انظر js/core/kv.js */
const store = {
  get(k,d){
    try{
      if (k === 'ai_chats' && QuarkKV.server) return QuarkKV.chatsArray() ?? d;
      const raw = QuarkKV.get(k); return raw == null ? d : (JSON.parse(raw) ?? d);
    }catch{ return d; }
  },
  set(k,v){ try{ if (k === 'ai_chats') QuarkKV.setChats(v); else QuarkKV.set(k, JSON.stringify(v)); }catch{} },
  setRaw(k,s){ try{ return QuarkKV.set(k, s) !== false; }catch{ return false; } },   /* نص جاهز؛ يعيد false عند الفشل */
  remove(k){ try{ QuarkKV.remove(k); }catch{} },
};
const epId = () => 'e' + Math.random().toString(36).slice(2,9);
function loadSettings(){
  const s3 = store.get('ai_settings_v3', null);
  if (s3) return { endpoints:s3.endpoints || [], sel:s3.sel || null, theme:s3.theme || 'auto', fontSize:s3.fontSize || 'md', systemPrompt:s3.systemPrompt ?? DEFAULT_SYSTEM, autoTitle:s3.autoTitle !== false, params:s3.params, themeSel:s3.themeSel, customThemes:s3.customThemes, msgStyle:s3.msgStyle, cont:s3.cont, gw:s3.gw, research:s3.research, skills:s3.skills, memory:s3.memory, defs:s3.defs };
  const o = store.get('ai_settings_v2', {}), endpoints = []; let sel = null;
  for (const k of ['openrouter','anthropic','openai']){
    const p = o.p?.[k]; if (!p) continue;
    const customBase = k === 'openai' && p.baseUrl && !/api\.openai\.com/.test(p.baseUrl);
    if (!p.key && !customBase) continue;
    const url = k === 'openai' ? (p.baseUrl || PRESETS.openai.url) : PRESETS[k].url;
    const e = { id:epId(), preset:k, url, key:p.key || '', proto:k === 'anthropic' ? 'anthropic' : 'openai',
      kind:/localhost|127\.0\.0\.1|192\.168\./.test(url) ? 'local' : 'api', enabled:true, models:p.model ? [{ id:p.model, on:true }] : [] };
    endpoints.push(e); if (o.active === k && p.model) sel = { ep:e.id, model:p.model };
  }
  return { endpoints, sel, theme:o.theme || 'auto', fontSize:o.fontSize || 'md', systemPrompt:o.systemPrompt ?? DEFAULT_SYSTEM, autoTitle:true, params:null };
}
const settings = loadSettings();
settings.msgStyle = 'plain';
settings.cont = { stripe:'accent', color:'#5b8def', radius:'round', bw:'thin', alpha:'solid', sep:false, spoiler:false, actions:false, header:false, sections:false, user:false, ...(settings.cont && typeof settings.cont === 'object' ? settings.cont : {}) };
if (!['none','accent','custom'].includes(settings.cont.stripe)) settings.cont.stripe = 'accent';
if (!/^#[0-9a-f]{6}$/i.test(settings.cont.color)) settings.cont.color = '#5b8def';
if (!['sharp','round','pill'].includes(settings.cont.radius)) settings.cont.radius = 'round';
if (!['none','thin','bold'].includes(settings.cont.bw)) settings.cont.bw = 'thin';
if (!['solid','soft','glass'].includes(settings.cont.alpha)) settings.cont.alpha = 'solid';
['sep','spoiler','actions','header','sections','user'].forEach(k => { settings.cont[k] = settings.cont[k] === true; });

/* انميشن الشعار عند فتح التطبيق (الإعدادات ← عام ← انميشن الدخول) — مفعّل افتراضيًا */
const introOn = () => store.get('ai_intro', true) !== false;
