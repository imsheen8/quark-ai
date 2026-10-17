/* QUARK AI — نماذج على الجهاز: كتالوج النماذج + قراءة ملفات GGUF من Hugging Face (أو مرآة) + البحث
   الكتالوج المضمّن «بذور» فقط (المستودع + العائلة + عدد المعاملات)؛ أسماء الملفات وأحجامها تُقرأ حيًّا من المستودع
   فلا تتعطل الروابط إن تغيّرت التسمية. */
(function(root){
  'use strict';
  const od = root.__od = root.__od || {};
  const GB = 1024 * 1024 * 1024;

  /* arabic: 0 ضعيف · 1 مقبول · 2 جيد   |   tags: chat code think small */
  const SEED = [
    { id:'qwen3-0.6b',   name:'Qwen3 0.6B',        fam:'Qwen',   params:0.6, repo:'unsloth/Qwen3-0.6B-GGUF',                    ar:2, tags:['small','think'], ctx:32768, note:'أصغر نموذج جيد بالعربية، يفكّر قبل الرد' },
    { id:'qwen25-0.5b',  name:'Qwen2.5 0.5B',      fam:'Qwen',   params:0.5, repo:'Qwen/Qwen2.5-0.5B-Instruct-GGUF',            ar:1, tags:['small'],         ctx:32768, note:'خفيف جدًا للأجهزة الضعيفة' },
    { id:'smollm2-360m', name:'SmolLM2 360M',      fam:'SmolLM', params:0.36, repo:'HuggingFaceTB/SmolLM2-360M-Instruct-GGUF',  ar:0, tags:['small'],         ctx:8192,  note:'للتجربة السريعة فقط، إنجليزي في الغالب' },
    { id:'gemma3-1b',    name:'Gemma 3 1B',        fam:'Gemma',  params:1.0, repo:'unsloth/gemma-3-1b-it-GGUF',                 ar:2, tags:['chat'],          ctx:32768, note:'متوازن وسريع، عربي جيد' },
    { id:'llama32-1b',   name:'Llama 3.2 1B',      fam:'Llama',  params:1.2, repo:'bartowski/Llama-3.2-1B-Instruct-GGUF',       ar:1, tags:['chat'],          ctx:131072, note:'سياق طويل بحجم صغير' },
    { id:'qwen25-1.5b',  name:'Qwen2.5 1.5B',      fam:'Qwen',   params:1.5, repo:'Qwen/Qwen2.5-1.5B-Instruct-GGUF',            ar:2, tags:['chat'],          ctx:32768, note:'أفضل توازن بين الجودة والسرعة على الهاتف' },
    { id:'qwen3-1.7b',   name:'Qwen3 1.7B',        fam:'Qwen',   params:1.7, repo:'unsloth/Qwen3-1.7B-GGUF',                    ar:2, tags:['think'],         ctx:32768, note:'يدعم وضع التفكير، عربي جيد' },
    { id:'smollm2-1.7b', name:'SmolLM2 1.7B',      fam:'SmolLM', params:1.7, repo:'bartowski/SmolLM2-1.7B-Instruct-GGUF',       ar:0, tags:['chat'],          ctx:8192,  note:'جيد بالإنجليزية' },
    { id:'qwen25c-1.5b', name:'Qwen2.5 Coder 1.5B',fam:'Qwen',   params:1.5, repo:'Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF',      ar:1, tags:['code'],          ctx:32768, note:'مساعد برمجة خفيف' },
    { id:'gemma2-2b',    name:'Gemma 2 2B',        fam:'Gemma',  params:2.6, repo:'bartowski/gemma-2-2b-it-GGUF',               ar:1, tags:['chat'],          ctx:8192,  note:'نموذج مستقر من جوجل' },
    { id:'llama32-3b',   name:'Llama 3.2 3B',      fam:'Llama',  params:3.2, repo:'bartowski/Llama-3.2-3B-Instruct-GGUF',       ar:1, tags:['chat'],          ctx:131072, note:'أذكى لكنه أبطأ على الهاتف' },
    { id:'qwen25-3b',    name:'Qwen2.5 3B',        fam:'Qwen',   params:3.1, repo:'Qwen/Qwen2.5-3B-Instruct-GGUF',              ar:2, tags:['chat'],          ctx:32768, note:'جودة أعلى بالعربية' },
    { id:'qwen25c-3b',   name:'Qwen2.5 Coder 3B',  fam:'Qwen',   params:3.1, repo:'Qwen/Qwen2.5-Coder-3B-Instruct-GGUF',        ar:1, tags:['code'],          ctx:32768, note:'برمجة أقوى' },
    { id:'qwen3-4b',     name:'Qwen3 4B',          fam:'Qwen',   params:4.0, repo:'unsloth/Qwen3-4B-GGUF',                      ar:2, tags:['think'],         ctx:32768, note:'الأذكى ضمن ما يتسع للهاتف، لأجهزة قوية' },
    { id:'gemma3-4b',    name:'Gemma 3 4B',        fam:'Gemma',  params:4.3, repo:'unsloth/gemma-3-4b-it-GGUF',                 ar:2, tags:['chat','vision'], ctx:131072, vision:true, note:'عربي ممتاز ويفهم الصور، ثقيل نسبيًا' },
    { id:'qwen3vl-2b',   name:'Qwen3-VL 2B',       fam:'Qwen',   params:2.1, repo:'unsloth/Qwen3-VL-2B-Instruct-GGUF',          ar:2, tags:['vision'],        ctx:32768, vision:true, note:'يقرأ الصور والنصوص داخلها (OCR)، خفيف نسبيًا' },
    { id:'qwen3vl-4b',   name:'Qwen3-VL 4B',       fam:'Qwen',   params:4.0, repo:'unsloth/Qwen3-VL-4B-Instruct-GGUF',          ar:2, tags:['vision'],        ctx:32768, vision:true, note:'فهم صور أقوى، لأجهزة قوية' },
    { id:'qwen25vl-3b',  name:'Qwen2.5-VL 3B',     fam:'Qwen',   params:3.8, repo:'unsloth/Qwen2.5-VL-3B-Instruct-GGUF',        ar:1, tags:['vision'],        ctx:32768, vision:true, note:'مستقر لقراءة الصور والمستندات' },
    { id:'smolvlm2-2b',  name:'SmolVLM2 2.2B',     fam:'SmolLM', params:2.2, repo:'ggml-org/SmolVLM2-2.2B-Instruct-GGUF',       ar:0, tags:['vision','small'],ctx:8192,  vision:true, note:'صغير لوصف الصور (إنجليزي في الغالب)' },
    { id:'phi35-mini',   name:'Phi-3.5 mini',      fam:'Phi',    params:3.8, repo:'bartowski/Phi-3.5-mini-instruct-GGUF',       ar:0, tags:['chat'],          ctx:131072, note:'قوي في الاستدلال، ضعيف بالعربية' },
    { id:'tinyllama',    name:'TinyLlama 1.1B',    fam:'Llama',  params:1.1, repo:'TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF',     ar:0, tags:['small'],         ctx:2048,  note:'قديم لكنه خفيف جدًا' },
  ];

  /* الحجم التقريبي قبل قراءة المستودع: Q4_K_M ≈ 4.85 بت لكل معامل */
  const approxBytes = (paramsB, quant = 'Q4_K_M') => Math.round(paramsB * 1e9 * (BITS[quant] || 4.85) / 8 * 1.02);
  const BITS = { Q2_K:3.0, Q3_K_S:3.5, Q3_K_M:3.9, Q3_K_L:4.2, IQ4_XS:4.3, Q4_0:4.6, Q4_K_S:4.6, Q4_K_M:4.85, Q5_K_S:5.5, Q5_K_M:5.7, Q6_K:6.6, Q8_0:8.5, F16:16, BF16:16 };
  /* ترتيب تفضيل الجودة/الحجم عند اختيار الصيغة تلقائيًا */
  const QUANT_PREF = ['Q4_K_M', 'Q4_K_S', 'Q4_0', 'IQ4_XS', 'Q5_K_M', 'Q5_K_S', 'Q3_K_M', 'Q3_K_L', 'Q3_K_S', 'Q6_K', 'Q8_0', 'Q2_K'];
  const QUANT_RE = /(?:^|[-_.])((?:IQ\d_[A-Z]+|Q\d_K_[SML]|Q\d_K|Q\d_[01]|BF16|F16|F32))(?=$|[-_.])/i;

  /* ---------- قراءة أسماء الملفات ---------- */
  function quantOf(name){
    const base = String(name).replace(/\.gguf$/i, '').replace(/-\d{5}-of-\d{5}$/i, '');
    const m = QUANT_RE.exec(base); return m ? m[1].toUpperCase() : '';
  }
  /* يحوّل قائمة ملفات المستودع إلى «صيغ»: كل صيغة = ملف واحد أو أجزاء متعددة. يتجاهل mmproj وimatrix وغيرها. */
  function variantsFromFiles(files){
    const map = new Map();
    for (const f of files || []){
      const path = String(f.path || f.name || ''), size = Number(f.size ?? f.lfs?.size) || 0;
      if (!/\.gguf$/i.test(path) || /mmproj|imatrix|vocab|\.imatrix/i.test(path)) continue;
      const file = path.split('/').pop(), part = /-(\d{5})-of-(\d{5})\.gguf$/i.exec(file);
      const quant = quantOf(file) || 'غير معروف';
      const key = (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) + '/' : '') + file.replace(/-\d{5}-of-\d{5}\.gguf$/i, '').replace(/\.gguf$/i, '');
      let v = map.get(key); if (!v){ v = { key, quant, files:[], total:part ? Number(part[2]) : 1 }; map.set(key, v); }
      v.files.push({ path, size, idx:part ? Number(part[1]) : 1 });
    }
    const mm = pickMmproj(files);
    const out = [];
    for (const v of map.values()){
      v.files.sort((a, b) => a.idx - b.idx);
      v.complete = v.files.length === v.total;                         /* أجزاء ناقصة = غير صالحة */
      v.size = v.files.reduce((n, f) => n + f.size, 0);
      if (mm){ v.mmproj = mm; v.msize = mm.size; }
      if (v.complete) out.push(v);
    }
    return out;
  }
  /* ملف الرؤية (mmproj) الأنسب في المستودع: F16 ثم BF16 ثم Q8_0 (الأصغر يخسر دقة الصور) */
  function pickMmproj(files){
    const c = (files || []).map(f => ({ path:String(f.path || f.name || ''), size:Number(f.size ?? f.lfs?.size) || 0 })).filter(f => /\.gguf$/i.test(f.path) && /mmproj/i.test(f.path));
    if (!c.length) return null;
    const pref = ['F16', 'BF16', 'Q8_0', 'F32'], rank = f => { const i = pref.indexOf(quantOf(f.path.split('/').pop())); return i < 0 ? 9 : i; };
    return [...c].sort((a, b) => rank(a) - rank(b) || a.size - b.size)[0];
  }
  /* يختار أنسب صيغة: الأعلى تفضيلًا مما يتسع في maxBytes، وإلا الأصغر المتاح */
  function pickVariant(vars, maxBytes, prefer){
    if (!vars.length) return null;
    if (prefer){ const p = vars.find(v => v.quant === prefer); if (p) return p; }
    const score = v => { const i = QUANT_PREF.indexOf(v.quant); return i < 0 ? 99 : i; };
    const sorted = [...vars].sort((a, b) => score(a) - score(b) || a.size - b.size);
    if (maxBytes){ const fit = sorted.find(v => v.size > 0 && v.size <= maxBytes); if (fit) return fit; return [...vars].sort((a, b) => a.size - b.size)[0]; }
    return sorted[0];
  }

  /* ---------- Hugging Face ---------- */
  const cleanRepo = s => String(s || '').trim().replace(/^https?:\/\/[^/]+\//i, '').replace(/^models\//, '').split(/[?#]/)[0].split('/').slice(0, 2).join('/');
  const validRepo = s => /^[\w.-]+\/[\w.-]+$/.test(s);
  /* رابط ملف مباشر: https://huggingface.co/owner/repo/(resolve|blob)/branch/path.gguf */
  function parseUrl(s){
    const m = /^https?:\/\/[^/]+\/([\w.-]+\/[\w.-]+)\/(?:resolve|blob)\/([^/]+)\/(.+?\.gguf)(?:[?#].*)?$/i.exec(String(s || '').trim());
    return m ? { repo:m[1], rev:m[2], path:decodeURIComponent(m[3]) } : null;
  }
  function headers(cfg){ const h = { accept:'application/json' }; if (cfg?.token) h.authorization = 'Bearer ' + cfg.token; return h; }
  async function jget(url, cfg, f){
    const res = await (f || root.fetch)(url, { headers:headers(cfg) });
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error('المستودع يتطلب تسجيل دخول Hugging Face (أضف الرمز من إعدادات التنزيل).'), { code:'auth' });
    if (res.status === 404) throw Object.assign(new Error('لم يُعثر على المستودع.'), { code:'notfound' });
    if (!res.ok) throw Object.assign(new Error('تعذّر الاتصال بـ Hugging Face (' + res.status + ').'), { code:'http' });
    return res.json();
  }
  /* ملفات المستودع (مع الأحجام) */
  async function listFiles(repo, cfg, f){
    const base = (cfg?.base || 'https://huggingface.co').replace(/\/+$/, '');
    const j = await jget(`${base}/api/models/${repo}/tree/main?recursive=true&expand=false`, cfg, f);
    return (Array.isArray(j) ? j : []).filter(x => x.type === 'file' || !x.type).map(x => ({ path:x.path, size:x.lfs?.size ?? x.size ?? 0 }));
  }
  async function resolveRepo(repo, cfg, f){
    const files = await listFiles(repo, cfg, f), variants = variantsFromFiles(files);
    if (!variants.length) throw Object.assign(new Error('لا توجد ملفات GGUF مناسبة في هذا المستودع.'), { code:'nogguf' });
    return variants;
  }
  const paramsFromName = s => { const m = /(?:^|[^\d.])(\d+(?:\.\d+)?)\s*[bB](?![a-zA-Z])/.exec(String(s)); const m2 = /(\d+(?:\.\d+)?)\s*[mM](?![a-zA-Z])/.exec(String(s)); return m ? parseFloat(m[1]) : m2 ? parseFloat(m2[1]) / 1000 : 0; };
  async function search(q, cfg, f, limit = 24){
    const base = (cfg?.base || 'https://huggingface.co').replace(/\/+$/, '');
    const qs = new URLSearchParams({ filter:'gguf', sort:'downloads', direction:'-1', limit:String(limit) }); if (q) qs.set('search', q);
    const j = await jget(`${base}/api/models?${qs}`, cfg, f);
    return (Array.isArray(j) ? j : []).map(m => ({ repo:m.id || m.modelId, downloads:m.downloads || 0, likes:m.likes || 0, updated:m.lastModified || '', gated:!!m.gated, params:paramsFromName(m.id || m.modelId), pipeline:m.pipeline_tag || '' }))
      .filter(m => m.repo);
  }
  const fileUrl = (cfg, repo, path) => `${(cfg?.base || 'https://huggingface.co').replace(/\/+$/, '')}/${repo}/resolve/main/${path.split('/').map(encodeURIComponent).join('/')}?download=true`;
  /* معرّف النموذج داخل التطبيق: owner/repo:QUANT */
  const modelId = (repo, quant) => repo + ':' + quant;
  const seedFor = repo => SEED.find(s => s.repo.toLowerCase() === String(repo).toLowerCase());
  const familyOf = s => { const n = String(s).toLowerCase(); return /qwen/.test(n) ? 'Qwen' : /gemma/.test(n) ? 'Gemma' : /llama/.test(n) ? 'Llama' : /phi/.test(n) ? 'Phi' : /smol/.test(n) ? 'SmolLM' : /mistral|ministral/.test(n) ? 'Mistral' : /deepseek/.test(n) ? 'DeepSeek' : 'أخرى'; };

  od.catalog = { SEED, QUANT_PREF, BITS, approxBytes, quantOf, variantsFromFiles, pickVariant, pickMmproj, cleanRepo, validRepo, parseUrl, listFiles, resolveRepo, search, fileUrl, modelId, seedFor, familyOf, paramsFromName, GB };
  if (typeof module !== 'undefined' && module.exports) module.exports = od.catalog;
})(typeof window !== 'undefined' ? window : globalThis);
