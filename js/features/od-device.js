/* QUARK AI — نماذج على الجهاز: فحص إمكانيات الجهاز (الذاكرة، المعالج، التخزين، دعم المحرك)
   يعمل في التطبيق (window.__od.device) وفي اختبارات Node (module.exports). */
(function(root){
  'use strict';
  const GB = 1024 * 1024 * 1024;
  const od = root.__od = root.__od || {};

  /* إعدادات النماذج على الجهاز (تُحفظ مع بقية بيانات التطبيق) */
  const CFG_KEY = 'ai_od_cfg', BENCH_KEY = 'ai_od_bench';
  const CFG_DEF = { base:'https://huggingface.co', token:'', wifiOnly:true, idleMin:10, ramGB:0, ctx:0, autoTitle:false, think:false, threads:0, gpu:false };
  function cfgGet(){
    let o = {}; try{ o = (typeof store !== 'undefined' ? store.get(CFG_KEY, {}) : JSON.parse(root.localStorage?.getItem(CFG_KEY) || '{}')) || {}; }catch{}
    const c = { ...CFG_DEF, ...o };
    c.base = String(c.base || CFG_DEF.base).replace(/\/+$/, '');
    c.idleMin = Math.max(0, Math.min(120, Number(c.idleMin) || 0));
    c.gpu = c.gpu === true; c.think = c.think === true; c.autoTitle = c.autoTitle === true; c.wifiOnly = c.wifiOnly !== false; c.token = String(c.token || '').trim();
    c.ramGB = Math.max(0, Math.min(64, Number(c.ramGB) || 0));
    c.ctx = [0, 1024, 2048, 4096, 8192].includes(Number(c.ctx)) ? Number(c.ctx) : 0;
    c.threads = Math.max(0, Math.min(12, Math.round(Number(c.threads) || 0)));
    return c;
  }
  function cfgSet(patch){
    const c = { ...cfgGet(), ...patch };
    try{ if (typeof store !== 'undefined') store.set(CFG_KEY, c); else root.localStorage?.setItem(CFG_KEY, JSON.stringify(c)); }catch{}
    return c;
  }
  /* قياس السرعة الفعلية (رموز/ث لكل حجم) يُحسّن التقديرات لاحقًا */
  /* القياس منفصل لكل محرك (سرعة WASM لا تنطبق على المحرك الأصلي) */
  const benchKey = () => (root.__od && root.__od.native && root.__od.native.available() ? BENCH_KEY + '_n' : BENCH_KEY);
  function benchGet(){ try{ return (typeof store !== 'undefined' ? store.get(benchKey(), null) : null) || { bw:0, n:0, models:{} }; }catch{ return { bw:0, n:0, models:{} }; } }
  function benchAdd(modelId, sizeBytes, tps){
    if (!(tps > 0) || !(sizeBytes > 0)) return;
    const b = benchGet(), bw = tps * sizeBytes / GB;                 /* GB/ث فعّالة = رموز/ث × حجم النموذج */
    b.bw = b.n ? b.bw * 0.6 + bw * 0.4 : bw; b.n = (b.n || 0) + 1;
    b.models = b.models || {}; b.models[modelId] = { tps:Math.round(tps * 10) / 10, at:Date.now() };
    try{ if (typeof store !== 'undefined') store.set(benchKey(), b); }catch{}
  }

  /* ---------- قراءة الجهاز ---------- */
  function parseUA(ua){
    const r = { android:0, model:'' };
    const m = /Android\s+([\d.]+)(?:;\s*([^;)]+?))?(?:\s+Build|[;)])/.exec(ua || '');
    if (m){ r.android = parseFloat(m[1]) || 0; r.model = (m[2] || '').trim(); }
    return r;
  }
  function gpuName(){
    try{
      const c = root.document.createElement('canvas'), gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (!gl) return '';
      const e = gl.getExtension('WEBGL_debug_renderer_info');
      return e ? String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL) || '') : '';
    }catch{ return ''; }
  }
  function nativeInfo(){
    try{
      const n = root.window && root.window.QuarkNative;
      if (n && typeof n.deviceInfo === 'function') return JSON.parse(n.deviceInfo() || '{}');
    }catch{}
    return null;
  }
  /* يجمع المعلومات الخام (بلا استنتاج). inject للاختبارات. */
  async function probe(inj = {}){
    const nav = inj.navigator || root.navigator || {}, nat = 'native' in inj ? inj.native : nativeInfo();
    const ua = nav.userAgent || '', u = parseUA(ua);
    const d = {
      src: nat && nat.totalMem ? 'native' : 'web',
      ram: 0, ramExact: false, ramAvail: 0, cores: Number(nat?.cores) || Number(nav.hardwareConcurrency) || 4,
      freeGB: null, totalGB: null, quotaGB: null, usedGB: null,
      android: nat?.release ? parseFloat(nat.release) : u.android, sdk: Number(nat?.sdk) || 0,
      model: nat ? [nat.brand, nat.model].filter(Boolean).join(' ') : u.model, soc: nat?.soc || '', abi: nat?.abi || '',
      gpu: 'gpu' in inj ? inj.gpu : gpuName(), webgpu: !!nav.gpu,
      isolated: 'isolated' in inj ? !!inj.isolated : !!root.crossOriginIsolated,
      sab: typeof (inj.SharedArrayBuffer ?? root.SharedArrayBuffer) !== 'undefined',
      mobile: /Mobi|Android/i.test(ua) || !!nat, saveData: !!nav.connection?.saveData, net: nav.connection?.effectiveType || '', netType: nav.connection?.type || '',
      opfs: !!(nav.storage && nav.storage.getDirectory), lowMem: !!nat?.lowMem,
      engine: 'engine' in inj ? inj.engine : (root.__od && root.__od.native && root.__od.native.available() ? 'native' : 'wasm'),
    };
    if (nat?.totalMem){ d.ram = nat.totalMem / GB; d.ramExact = true; d.ramAvail = (nat.availMem || 0) / GB; }
    else if (nav.deviceMemory){ d.ram = Number(nav.deviceMemory); d.ramExact = false; }       /* Chrome يقرّبه ويحدّه بـ 8 */
    if (nat?.freeBytes){ d.freeGB = nat.freeBytes / GB; d.totalGB = (nat.totalBytes || 0) / GB; }
    try{
      const est = nav.storage?.estimate ? await nav.storage.estimate() : null;
      if (est){ d.quotaGB = (est.quota || 0) / GB; d.usedGB = (est.usage || 0) / GB; if (d.freeGB == null) d.freeGB = Math.max(0, d.quotaGB - d.usedGB); }
    }catch{}
    return d;
  }

  /* ---------- الاستنتاج: الذاكرة الفعّالة والفئة والقدرة على التشغيل ---------- */
  function classify(d, cfg = cfgGet(), bench = benchGet()){
    const x = { ...d };
    if (cfg.ramGB > 0){ x.ram = cfg.ramGB; x.ramExact = true; x.ramManual = true; }
    if (!x.ram) x.ram = 4;                                              /* لا معلومة: نفترض هاتفًا متوسطًا */
    x.ramGuess = !x.ramExact && !x.ramManual;
    x.threads = !!(x.isolated && x.sab);                                /* المحرك متعدد الخيوط يحتاج عزلًا عبر الأصول */
    x.tier = x.ram <= 3.5 ? 'low' : x.ram <= 6.5 ? 'mid' : x.ram <= 11.5 ? 'high' : 'ultra';
    x.native = x.engine === 'native';
    if (x.native){
      /* المحرك الأصلي: بلا حد 4GB؛ الأوزان تُقرأ بـ mmap فيبقى لنظام التشغيل هامش (~45%) */
      x.engineCapGB = Math.max(1, x.ram * 0.8);
      x.usableGB = Math.min(24, x.ram * 0.55);
      const big = Math.max(1, Math.min(6, (x.cores || 4) >= 8 ? 4 : (x.cores || 4) >= 6 ? 3 : 2));
      x.bwGBs = bench.bw > 0 ? bench.bw : 2.8 * big + 1;         /* ≈ 6 / 9.4 / 12 GB/ث */
      x.bwMeasured = bench.bw > 0;
    } else {
      /* سعة المحرك: WASM بعنوان 32 بت (حد ~4GB للصفحة) — أما الذاكرة المتاحة للتطبيق فنصف الذاكرة تقريبًا */
      x.engineCapGB = 3.4;
      x.usableGB = Math.min(x.engineCapGB, x.ram * 0.5);
      /* نطاق ترددي فعّال تقريبي لفك التوليد (GB/ث): خيط واحد ≈ 3، وعدة خيوط أسرع قليلًا */
      const base = x.threads ? 3 * Math.min(4, Math.max(1, (x.cores || 4) - 1)) * 0.65 : 3;
      x.bwGBs = bench.bw > 0 ? bench.bw : base; x.bwMeasured = bench.bw > 0;
    }
    if (x.ramAvail && x.ramAvail < x.usableGB) x.availWarn = true;
    return x;
  }
  async function detect(inj){ return classify(await probe(inj)); }

  const TIERS = { low:'جهاز محدود', mid:'جهاز متوسط', high:'جهاز قوي', ultra:'جهاز قوي جدًا' };
  const fmtGB = (g, p = 1) => g == null || !isFinite(g) ? '—' : (g >= 10 ? Math.round(g) : g.toFixed(p).replace(/\.0$/, '')) + ' GB';

  od.device = { probe, classify, detect, cfgGet, cfgSet, benchGet, benchAdd, parseUA, TIERS, fmtGB, GB, CFG_DEF };
  if (typeof module !== 'undefined' && module.exports) module.exports = od.device;
})(typeof window !== 'undefined' ? window : globalThis);
