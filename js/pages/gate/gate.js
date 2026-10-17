/* QUARK AI — شاشة البداية (أول فتح): ربط انميشن الدخول وصفحة التسجيل (intro.js) ببيانات التطبيق */
'use strict';

const GATE_MODELS = {
  openrouter:['openai/gpt-4o-mini','anthropic/claude-sonnet-4.5','google/gemini-2.5-flash','deepseek/deepseek-chat'],
  openai:['gpt-4o-mini','gpt-4o'], anthropic:['claude-sonnet-5-5','claude-opus-5-5','claude-haiku-5-5'],
  deepseek:['deepseek-chat','deepseek-reasoner'], gemini:['gemini-2.5-flash','gemini-2.5-pro'],
  groq:['llama-3.3-70b-versatile'], ollama:[], lmstudio:[], custom:[],
};

/* الحساب محلي على هذا الجهاز (لا يوجد خادم حسابات): البريد + ملح + بصمة SHA-256 لكلمة المرور */
const ACCOUNT_KEY = 'ai_account';
function saveAccount(email, pass){
  const salt = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  store.set(ACCOUNT_KEY, { email:email.toLowerCase(), salt, hash:sha256(salt + ':' + pass) });
}
function checkAccount(email, pass){
  const A = store.get(ACCOUNT_KEY, null);
  if (!A) return 'لا يوجد حساب على هذا الجهاز — أنشئ حسابًا جديدًا';
  if (A.email !== email.toLowerCase() || sha256(A.salt + ':' + pass) !== A.hash) return 'البريد أو كلمة المرور غير صحيحة';
  return '';
}

async function runGate(){
  const g = $('gate'); g.hidden = false;
  let d;
  try{
    d = await QuarkIntro.runFull({
      presets: PRESETS, models: GATE_MODELS, profile: getProfile(),
      hasEndpoints: settings.endpoints.length > 0, hasAccount: !!store.get(ACCOUNT_KEY, null),
      signIn: checkAccount,
    });
  }catch(e){
    /* تعذّر تحميل واجهة الدخول: لا نُبقي التطبيق عالقًا */
    console.error('QUARK gate:', e); QuarkIntro.uncover();
    store.set('ai_onboarded', true); g.hidden = true; toast('تعذّر تحميل شاشة الدخول'); return;
  }
  if (d.mode === 'signup'){
    saveAccount(d.email, d.password);
    const pf = getProfile(); pf.name = d.name; pf.photo = d.photo; setProfile(pf);
    if (d.model){
      const { preset:k, url, key, model } = d.model, p = PRESETS[k];
      let ep = settings.endpoints.find(e => norm(e.url) === url && e.key === key);
      if (!ep){ ep = { id:epId(), preset:k, url, key, proto:p.proto, kind:p.kind, enabled:true, models:[] }; settings.endpoints.push(ep); }
      const ex = ep.models.find(m => m.id === model);
      if (ex) ex.on = true; else ep.models.push({ id:model, on:true });
      settings.sel = { ep:ep.id, model }; persistSettings();
    }
  }
  store.set('ai_onboarded', true);
  g.hidden = true; renderAvatars(); updateModelLabels();
  const nm = getProfile().name;
  toast(d.mode === 'signin' ? 'أهلًا بعودتك' : 'أهلًا ' + nm);
  await QuarkIntro.close();
}
