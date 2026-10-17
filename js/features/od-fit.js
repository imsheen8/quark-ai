/* QUARK AI — نماذج على الجهاز: تقييم ملاءمة النموذج للجهاز واقتراح الأنسب
   (فكرة «HW Fit» في Odysseus: حجم النموذج + ذاكرة السياق مقابل ذاكرة الجهاز وسرعته). التقديرات تقريبية وتتحسّن بعد أول تشغيل فعلي. */
(function(root){
  'use strict';
  const od = root.__od = root.__od || {};
  const GB = 1024 * 1024 * 1024;

  /* ذاكرة السياق (KV) تقريبًا: تتناسب مع عدد المعاملات والسياق */
  const kvBytes = (paramsB, ctx) => Math.min(0.45 * GB, Math.max(0.05 * GB, 0.07 * GB * paramsB * ctx / 2048));
  const ctxFor = (dev, cfgCtx) => cfgCtx || (dev.native && dev.ram >= 11 ? 8192 : dev.ram >= 7.5 ? 4096 : dev.ram >= 5 ? 2048 : 1536);
  /* extra = حجم ملف الرؤية (mmproj) إن وُجد: يُحمَّل في الذاكرة مع النموذج ويحتاج مساحة عمل لترميز الصور */
  const needBytes = (sizeBytes, paramsB, ctx, extra = 0) => sizeBytes * 1.06 + kvBytes(paramsB || sizeBytes / GB / 0.6, ctx) + 0.35 * GB + (extra > 0 ? extra * 1.1 + 0.25 * GB : 0);
  /* أكبر سياق يتسع لهذا النموذج (يُخفَّض تلقائيًا للنماذج الكبيرة)؛ إن حدّده المستخدم يُحترم كما هو */
  function ctxForModel(sizeBytes, paramsB, dev, cfgCtx, extra = 0){
    const top = ctxFor(dev, cfgCtx); if (cfgCtx) return top;
    for (const c of [top, 4096, 2048, 1536, 1024]) if (c <= top && needBytes(sizeBytes, paramsB, c, extra) <= dev.usableGB * GB) return c;
    return Math.min(top, 1024);
  }
  const tpsOf = (sizeBytes, dev) => dev.bwGBs / Math.max(0.05, sizeBytes / GB);

  const LEVELS = {
    great:{ label:'ممتاز لجهازك', cls:'ok',   rank:4 },
    good: { label:'مناسب',        cls:'ok',   rank:3 },
    slow: { label:'بطيء',         cls:'warn', rank:2 },
    tight:{ label:'على الحد',     cls:'warn', rank:1 },
    no:   { label:'لا يناسب',     cls:'bad',  rank:0 },
  };

  /* item: { sizeBytes, params (مليار), ar (0-2), tags[] } — dev: ناتج device.classify */
  function fit(item, dev, opts = {}){
    const size = item.sizeBytes || 0, params = item.params || 0, extra = item.extraBytes || 0, ctx = ctxForModel(size, params, dev, opts.ctx, extra);
    const need = needBytes(size, params, ctx, extra), usable = dev.usableGB * GB, tps = tpsOf(size, dev);
    const why = [];
    let level;
    if (size + 0.2 * GB > dev.engineCapGB * GB){ level = 'no'; why.push(dev.native ? 'أكبر من ذاكرة جهازك' : 'أكبر مما يتسع له محرك التشغيل داخل التطبيق'); }
    else if (need > usable){ level = 'no'; why.push('يحتاج ≈' + (need / GB).toFixed(1) + ' GB من الذاكرة وجهازك يتّسع لحوالي ' + (usable / GB).toFixed(1) + ' GB'); }
    else if (need > usable * 0.88){ level = 'tight'; why.push('قريب جدًا من حد الذاكرة وقد يتعطل مع تطبيقات أخرى'); }
    else if (tps < 1.5){ level = 'slow'; why.push('بطيء جدًا (≈' + tps.toFixed(1) + ' رمز/ث)'); }
    else if (tps < 3){ level = 'slow'; why.push('بطيء نسبيًا'); }
    else if (tps >= 6 && need < usable * 0.6){ level = 'great'; }
    else level = 'good';
    if (dev.availWarn && level !== 'no') why.push('الذاكرة الحرة الآن منخفضة — أغلق بعض التطبيقات قبل التشغيل');
    /* ترتيب «الأنسب»: جودة تتناسب مع الجذر التربيعي للمعاملات × دعم العربية × عقوبة البطء */
    let score = -1;
    if (level !== 'no'){
      const q = Math.sqrt(Math.max(params, 0.2)), arW = 1 + 0.3 * (item.ar || 0), spd = Math.min(1, tps / 4);
      score = q * arW * spd * (level === 'tight' ? 0.6 : 1);
    }
    return { level, ...LEVELS[level], tps, needBytes:need, ctx, score, why };
  }

  function fmtBytes(b){
    if (!(b > 0)) return '—';
    return b >= GB ? (b / GB >= 10 ? Math.round(b / GB) : (b / GB).toFixed(1).replace(/\.0$/, '')) + ' GB' : Math.round(b / 1048576) + ' MB';
  }
  function fmtTps(t){ return t >= 10 ? String(Math.round(t)) : t >= 1 ? t.toFixed(1).replace(/\.0$/, '') : '<1'; }

  /* مجموعات الاقتراح من قائمة عناصر عليها .fit */
  function pickGroups(items){
    const ok = items.filter(x => x.fit && x.fit.level !== 'no');
    const by = (arr, fn) => [...arr].sort((a, b) => fn(b) - fn(a))[0] || null;
    const good = ok.filter(x => x.fit.rank >= 3);
    const best = by(good.length ? good : ok, x => x.fit.score);
    const fast = by(ok, x => x.fit.tps - (x.params || 0) * 0.001);
    const smart = by(good.length ? good : ok, x => (x.params || 0) * (x.fit.rank >= 2 ? 1 : 0.3));
    const arabic = by(ok.filter(x => (x.ar || 0) >= 2), x => x.fit.score);
    const code = by(ok.filter(x => (x.tags || []).includes('code')), x => x.fit.score);
    return { best, fast, smart, arabic, code };
  }

  od.fit = { fit, pickGroups, fmtBytes, fmtTps, kvBytes, ctxFor, ctxForModel, needBytes, tpsOf, LEVELS, GB };
  if (typeof module !== 'undefined' && module.exports) module.exports = od.fit;
})(typeof window !== 'undefined' ? window : globalThis);
