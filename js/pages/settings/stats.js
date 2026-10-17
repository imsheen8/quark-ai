/* QUARK AI — صفحة الإحصائيات (الإعدادات ← الإحصائيات)
   تجمع بيانات النص (محادثاتك + سجل الطلبات) والصوت (قراءة وتفريغ) والنماذج، وتعرضها كمؤشرات ورسوم ورؤى.
   «نظرة عامة» التي كانت في صفحة النماذج انتقلت إلى تبويب «النماذج» هنا. */
'use strict';

(() => {
  const DAY = 864e5, LOC = 'ar-u-nu-latn';
  const TABS = [['sum', 'الملخص', 'chart'], ['text', 'النص', 'message'], ['voice', 'الصوت', 'sh-wave'], ['models', 'النماذج', 'cpu']];
  const PERS = [['1', 'اليوم'], ['7', '7 أيام'], ['30', '30 يومًا'], ['90', '90 يومًا'], ['all', 'الكل']];
  const ui = { tab:'sum', per:'30', met:'req', allModels:false, ...store.get('ai_st_ui', {}) };
  const saveUi = () => store.set('ai_st_ui', { tab:ui.tab, per:ui.per, met:ui.met });
  const ico = n => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const keyRes = {};            /* نتائج اختبار مفاتيح الصوت (في الذاكرة) */
  let timer = 0, keyBusy = false;

  /* ---------- تنسيق ---------- */
  const fmtN = n => { n = Math.round(n || 0); return n < 1e3 ? String(n) : n < 1e6 ? (n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, '') + 'K' : (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'; };
  const fmtMs = ms => ms == null || !isFinite(ms) ? '—' : ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + ' s';
  const fmtDur = s => { s = Math.round(s || 0); if (s < 60) return s + ' ث'; const m = Math.floor(s / 60); if (m < 60) return m + ' د' + (s % 60 ? ' ' + (s % 60) + ' ث' : ''); const h = Math.floor(m / 60); return h + ' س' + (m % 60 ? ' ' + (m % 60) + ' د' : ''); };
  const fmtB = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const sum = (a, f) => a.reduce((n, x) => n + (f(x) || 0), 0);
  const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const dkey = ts => { const d = new Date(ts); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
  const sod = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const dlab = ts => new Date(ts).toLocaleDateString(LOC, { day:'numeric', month:'short' });
  const hlab = h => (h % 12 || 12) + (h < 12 ? ' ص' : ' م');
  const WD = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const tok = n => Math.max(0, Math.round(n / 3.2));
  const E = s => esc(String(s == null ? '' : s));
  const ltr = s => `<span dir="ltr">${E(s)}</span>`;

  /* ---------- جمع البيانات ---------- */
  function range(per){
    const to = Date.now() + 1;
    if (per === 'all'){
      const U = window.__usage, f = [U.since()];
      chats.forEach(c => { if (!c.temp) c.messages.forEach(m => { if (m.ts) f.push(m.ts); }); });
      return { from:Math.min(...f), to, all:true };
    }
    const n = +per, from = sod(Date.now()) - (n - 1) * DAY;
    return { from, to, n };
  }
  function gather(from, to){
    const U = window.__usage, since = U.since(), inR = t => t >= from && t < to;
    const tx = [], img = [], tts = [], stt = [], usr = [];
    U.all().forEach(e => {
      if (!inR(e.ts)) return;
      if (e.t === 't') tx.push(e); else if (e.t === 'img') img.push(e); else if (e.t === 'tts') tts.push(e); else if (e.t === 'stt') stt.push(e);
    });
    let codeBlocks = 0, thinkMsgs = 0;
    chats.forEach(c => {
      if (c.temp) return;
      c.messages.forEach((m, i) => {
        if (m.role === 'user' && !m.error){
          let ts = c.ts; for (let j = i + 1; j < c.messages.length; j++){ if (c.messages[j].ts){ ts = c.messages[j].ts; break; } }
          if (inR(ts)) usr.push({ ts, c:(m.content || '').length, f:(m.files || []).length, im:(m.imgs || []).length, chat:c.id });
        } else if (m.role === 'assistant' && m.ts && inR(m.ts) && !m.error){
          codeBlocks += ((m.content || '').match(/```/g) || []).length >> 1;
          if (m.thinking) thinkMsgs++;
          if (!U.noBackfill() && m.ts < since){
            const items = m.cmp && m.cmp.length ? m.cmp.filter(x => !x.error && x.content) : [m];
            items.forEach(x => tx.push({ t:'t', k:'chat', ts:m.ts, m:x.model || m.model || '—', h:'', ok:true, ms:0, tt:0, i:0, o:tok((x.content || '').length), th:x.thinking ? tok(x.thinking.length) : 0, hist:1 }));
            if (m.gen && m.gen.length) img.push({ t:'img', ts:m.ts, m:m.model || '—', h:'', ok:true, n:m.gen.length, ms:0, hist:1 });
          }
        }
      });
    });
    return { tx, img, tts, stt, usr, codeBlocks, thinkMsgs };
  }
  const chatEv = g => g.tx.filter(e => e.k === 'chat');
  const live = a => a.filter(e => !e.hist);

  function tstats(g){
    const ev = chatEv(g), ok = ev.filter(e => e.ok), lv = live(ok).filter(e => e.ms > 0);
    const ms = lv.map(e => e.ms), tt = lv.filter(e => e.tt > 0).map(e => e.tt);
    const tps = lv.filter(e => e.o >= 20 && e.ms - e.tt > 200).map(e => e.o / ((e.ms - e.tt) / 1000));
    return {
      replies:ev.filter(e => e.ok).length, fails:live(ev).filter(e => !e.ok).length, sent:g.usr.length,
      tin:sum(ev, e => e.i), tout:sum(ev, e => e.o), tth:sum(ev, e => e.th),
      ms, avgMs:avg(ms), avgTt:avg(tt), avgTps:avg(tps), p50:q(ms, .5), p90:q(ms, .9), p95:q(ms, .95),
      rate:live(ev).length ? pct(live(ev).filter(e => e.ok).length, live(ev).length) : null,
      imgs:sum(g.img.filter(e => e.ok), e => e.n || 1), imgFails:g.img.filter(e => !e.ok).length,
      files:sum(g.usr, u => u.f), upImgs:sum(g.usr, u => u.im), uChars:sum(g.usr, u => u.c),
      thinkRep:ev.filter(e => e.th > 0).length, titles:g.tx.filter(e => e.k === 'title').length, labs:g.tx.filter(e => e.k === 'lab').length,
    };
  }
  function vstats(g){
    const t = g.tts, s = g.stt, tOk = t.filter(e => e.ok), api = live(t.filter(e => !e.cache)), cache = t.filter(e => e.cache);
    const lat = api.filter(e => e.ok && e.ms > 0).map(e => e.ms), sl = s.filter(e => e.ok && e.ms > 0).map(e => e.ms);
    return {
      tts:tOk.length, api:api.length, cache:cache.length, tFail:t.filter(e => !e.ok).length, chars:sum(tOk, e => e.c),
      secs:sum(tOk, e => (e.c || 0) / 15 / (e.r || 1)), bytes:sum(api, e => e.b), lat, avgLat:avg(lat), p90:q(lat, .9),
      tRate:api.length ? pct(api.filter(e => e.ok).length, api.length) : null,
      stt:s.filter(e => e.ok).length, sFail:s.filter(e => !e.ok).length, sChars:sum(s, e => e.c), sBytes:sum(s, e => e.b), sl, avgSl:avg(sl),
      sRate:s.length ? pct(s.filter(e => e.ok).length, s.length) : null,
    };
  }

  /* ---------- مكوّنات العرض ---------- */
  const delta = (cur, prev, low) => {
    if (prev == null || cur == null || !isFinite(prev) || !prev) return '';
    const d = Math.round((cur - prev) / prev * 100); if (!d) return '<small class="st-d">=</small>';
    const good = low ? d < 0 : d > 0;
    return `<small class="st-d ${good ? 'up' : 'down'}" title="مقارنة بالفترة السابقة">${d > 0 ? '▲' : '▼'} ${Math.abs(d)}%</small>`;
  };
  const kpi = (label, val, sub = '', dl = '') => `<div class="st-kpi"><span class="l">${label}</span><b dir="ltr">${val}</b><span class="s">${sub}${dl}</span></div>`;
  const card = (title, body, extra = '') => `<section class="st-card"><h4>${title}${extra}</h4>${body}</section>`;
  const empty = t => `<p class="st-empty">${t}</p>`;
  const hbars = (rows, cls = '') => rows.map(([l, n, mx, tip, sub]) => `<div class="st-hb ${cls}"><span class="n" dir="auto">${E(l)}${sub ? `<small>${E(sub)}</small>` : ''}</span><i><u style="width:${mx ? Math.max(3, n / mx * 100) : 0}%"></u></i><b dir="ltr">${tip != null ? tip : n}</b></div>`).join('');
  const niceMax = v => { if (v <= 1) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };

  /* مخطط أعمدة: bk = [{l, tip, a, b}] — a أساسي، b متراكم فوقه */
  function barChart(bk, o = {}){
    if (!bk.length) return '';
    const W = 340, H = o.h || 150, pl = 34, pr = 6, pt = 8, pb = 22, iw = W - pl - pr, ih = H - pt - pb, bw = iw / bk.length;
    const mx = niceMax(Math.max(1, ...bk.map(x => (x.a || 0) + (x.b || 0)))), gap = bw > 9 ? 3 : bw > 4 ? 1.5 : .6, fm = o.fmt || fmtN;
    let g = '', bars = '', hits = '', xl = '';
    [0, .5, 1].forEach(f => { const y = pt + ih * (1 - f); g += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" class="gl"/><text x="${pl - 5}" y="${y + 3.5}" class="ax" text-anchor="end">${fm(mx * f)}</text>`; });
    const step = Math.max(1, Math.ceil(bk.length / 5));
    bk.forEach((x, i) => {
      const bx = pl + i * bw + gap / 2, w = Math.max(1.5, bw - gap), ha = ih * (x.a || 0) / mx, hb = ih * (x.b || 0) / mx;
      if (x.a) bars += `<rect x="${bx.toFixed(1)}" y="${(pt + ih - ha).toFixed(1)}" width="${w.toFixed(1)}" height="${ha.toFixed(1)}" rx="${Math.min(3, w / 2)}" class="b1"/>`;
      if (x.b) bars += `<rect x="${bx.toFixed(1)}" y="${(pt + ih - ha - hb).toFixed(1)}" width="${w.toFixed(1)}" height="${hb.toFixed(1)}" rx="${Math.min(3, w / 2)}" class="b2"/>`;
      hits += `<rect class="hit" x="${(pl + i * bw).toFixed(1)}" y="${pt}" width="${bw.toFixed(1)}" height="${ih}" data-tip="${E(x.tip)}"/>`;
      if (i % step === 0 || i === bk.length - 1) xl += `<text x="${(pl + i * bw + bw / 2).toFixed(1)}" y="${H - 6}" class="ax" text-anchor="middle">${E(x.l)}</text>`;
    });
    return `<div class="st-chart"><div class="st-read">${o.hint || 'اضغط على عمود لعرض التفاصيل'}</div><svg viewBox="0 0 ${W} ${H}" direction="ltr" role="img">${g}${bars}${xl}${hits}</svg></div>`;
  }
  function lineChart(pts, o = {}){
    const p = pts.filter(x => x.v != null);
    if (p.length < 2) return empty('تحتاج بيانات من يومين على الأقل لرسم الاتجاه.');
    const W = 340, H = 140, pl = 40, pr = 8, pt = 10, pb = 22, iw = W - pl - pr, ih = H - pt - pb, n = pts.length;
    const mx = niceMax(Math.max(...p.map(x => x.v))), fm = o.fmt || fmtMs;
    const X = i => pl + (n === 1 ? iw / 2 : i / (n - 1) * iw), Y = v => pt + ih * (1 - v / mx);
    let g = '';
    [0, .5, 1].forEach(f => { const y = pt + ih * (1 - f); g += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" class="gl"/><text x="${pl - 5}" y="${y + 3.5}" class="ax" text-anchor="end">${fm(mx * f)}</text>`; });
    const idx = pts.map((x, i) => x.v != null ? i : -1).filter(i => i >= 0);
    const d = idx.map((i, k) => (k ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(pts[i].v).toFixed(1)).join(' ');
    const area = d + ` L${X(idx[idx.length - 1]).toFixed(1)} ${pt + ih} L${X(idx[0]).toFixed(1)} ${pt + ih} Z`;
    const dots = idx.map(i => `<circle cx="${X(i).toFixed(1)}" cy="${Y(pts[i].v).toFixed(1)}" r="3" class="dot"/><circle class="hit" cx="${X(i).toFixed(1)}" cy="${Y(pts[i].v).toFixed(1)}" r="13" data-tip="${E(pts[i].tip)}"/>`).join('');
    const step = Math.max(1, Math.ceil(n / 5)); let xl = '';
    pts.forEach((x, i) => { if (i % step === 0 || i === n - 1) xl += `<text x="${X(i).toFixed(1)}" y="${H - 6}" class="ax" text-anchor="middle">${E(x.l)}</text>`; });
    return `<div class="st-chart"><div class="st-read">اضغط على نقطة لعرض التفاصيل</div><svg viewBox="0 0 ${W} ${H}" direction="ltr" role="img">${g}<path d="${area}" class="ar"/><path d="${d}" class="ln"/>${dots}${xl}</svg></div>`;
  }
  function heatmap(cnt, weeks = 15){
    const today = sod(Date.now()), dow = new Date(today).getDay(), start = today - ((weeks - 1) * 7 + dow) * DAY;
    const cell = 17, gap = 3, st = cell + gap, W = weeks * st, H = 7 * st;
    let mx = 0; cnt.forEach(v => { if (v > mx) mx = v; });
    let cells = '';
    for (let w = 0; w < weeks; w++) for (let d = 0; d < 7; d++){
      const ts = start + (w * 7 + d) * DAY; if (ts > today) continue;
      const v = cnt.get(dkey(ts)) || 0, lv = !v ? 0 : mx <= 1 ? 4 : Math.min(4, 1 + Math.floor((v - 1) / mx * 4));
      cells += `<rect x="${(weeks - 1 - w) * st}" y="${d * st}" width="${cell}" height="${cell}" rx="5" class="hm l${lv}" data-tip="${E(dlab(ts) + ' · ' + WD[d] + ' · ' + v + ' نشاط')}"/>`;
    }
    return `<div class="st-chart"><div class="st-read">اضغط على مربع لعرض نشاط اليوم</div><svg viewBox="0 0 ${W} ${H}" class="st-hm" role="img">${cells}</svg>
      <div class="st-lg"><span>أقل</span>${[0, 1, 2, 3, 4].map(l => `<i class="hm l${l}"></i>`).join('')}<span>أكثر</span></div></div>`;
  }

  /* مجموعات زمنية: يوم لكل عمود (أو أسبوع إذا طالت الفترة) */
  function buckets(r){
    const out = []; let step = DAY, start = sod(r.from);
    const days = Math.ceil((sod(Date.now()) - start) / DAY) + 1;
    if (days > 92){ step = 7 * DAY; }
    for (let t = start; t <= Date.now(); t += step) out.push({ from:t, to:t + step });
    return { list:out, step };
  }
  const inB = (b, ts) => ts >= b.from && ts < b.to;
  const blabel = (b, step) => dlab(b.from);

  /* ---------- الأقسام ---------- */
  function perChips(){
    return `<div class="st-per" role="group">${PERS.map(([k, l]) => `<button type="button" class="md-chip${ui.per === k ? ' on' : ''}" data-per="${k}">${l}</button>`).join('')}</div>`;
  }
  function streaks(){
    const U = window.__usage, set = new Set();
    U.all().forEach(e => set.add(dkey(e.ts)));
    chats.forEach(c => { if (!c.temp) c.messages.forEach(m => { if (m.ts) set.add(dkey(m.ts)); }); });
    const days = [...set].map(k => { const y = Math.floor(k / 10000), mo = Math.floor(k / 100) % 100, d = k % 100; return new Date(y, mo - 1, d).getTime(); }).sort((a, b) => a - b);
    let best = 0, run = 0, prev = 0;
    days.forEach(t => { run = prev && Math.round((t - prev) / DAY) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = t; });
    let cur = 0, t = sod(Date.now());
    if (!set.has(dkey(t))) t -= DAY;
    while (set.has(dkey(t))){ cur++; t -= DAY; }
    return { cur, best, active:days.length };
  }
  function activityMap(){
    const U = window.__usage, m = new Map(), add = ts => { const k = dkey(ts); m.set(k, (m.get(k) || 0) + 1); };
    U.all().forEach(e => { if (e.k !== 'title' && e.k !== 'test') add(e.ts); });
    chats.forEach(c => { if (!c.temp) c.messages.forEach(x => { if (x.role === 'assistant' && x.ts && x.ts < U.since() && !U.noBackfill()) add(x.ts); }); });
    return m;
  }

  function insights(r, g, T, V){
    const out = [], ev = chatEv(g);
    if (ev.length >= 3){
      const hrs = Array(24).fill(0); ev.forEach(e => hrs[new Date(e.ts).getHours()]++);
      const h = hrs.indexOf(Math.max(...hrs)); out.push(['clock', `ساعتك الأنشط هي <b>${hlab(h)}</b> — ${hrs[h]} رد في هذه الفترة.`]);
      const wd = Array(7).fill(0); ev.forEach(e => wd[new Date(e.ts).getDay()]++);
      const d = wd.indexOf(Math.max(...wd)); out.push(['calendar', `أكثر أيامك نشاطًا: <b>${WD[d]}</b>.`]);
      const byM = {}; ev.forEach(e => { byM[e.m] = (byM[e.m] || 0) + 1; });
      const top = Object.entries(byM).sort((a, b) => b[1] - a[1])[0];
      if (top) out.push(['cpu', `نموذجك المفضّل <b dir="ltr">${E(shortModel(top[0]))}</b> بنسبة ${pct(top[1], ev.length)}% من ردودك.`]);
    }
    if (T.avgTt != null) out.push(['clock', `متوسط أول رمز <b dir="ltr">${fmtMs(T.avgTt)}</b>${T.avgTps ? ` وسرعة توليد ≈ <b dir="ltr">${Math.round(T.avgTps)} tok/s</b>` : ''}.`]);
    if (T.rate != null && T.rate < 90 && T.fails) out.push(['info', `نسبة نجاح الطلبات <b>${T.rate}%</b> — راجع قسم الأخطاء في تبويب «النص».`]);
    if (T.thinkRep) out.push(['lightbulb', `${pct(T.thinkRep, Math.max(1, T.replies))}% من ردودك تضمّنت تفكيرًا موسّعًا.`]);
    if (V.tts + V.stt) out.push(['volume', `قرأ التطبيق لك <b>${fmtN(V.chars)}</b> حرفًا ≈ <b>${fmtDur(V.secs)}</b> من الصوت${V.stt ? `، وفرّغ ${V.stt} تسجيلًا` : ''}.`]);
    if (V.cache && V.tts) out.push(['database', `وفّرت الذاكرة المؤقتة <b>${V.cache}</b> طلب صوت (${pct(V.cache, V.tts)}%) من التوليد المتكرر.`]);
    return out;
  }

  function actChart(r, g){
    const { list, step } = buckets(r);
    const bk = list.map(b => {
      const t = chatEv(g).filter(e => inB(b, e.ts)).length + g.img.filter(e => inB(b, e.ts)).length, v = g.tts.filter(e => inB(b, e.ts)).length + g.stt.filter(e => inB(b, e.ts)).length;
      return { l:blabel(b, step), tip:`${dlab(b.from)}${step > DAY ? ' (أسبوع)' : ''} · نص ${t} · صوت ${v}`, a:t, b:v };
    });
    return { html:barChart(bk), step };
  }

  function dataCard(){
    const U = window.__usage, since = new Date(U.since()).toLocaleDateString(LOC, { day:'numeric', month:'long', year:'numeric' });
    return card('بيانات الإحصائيات', `<p class="st-note">يسجّل التطبيق كل طلب (نص، صور، صوت) محليًا على جهازك بدءًا من <b>${since}</b> — ${U.all().length} حدثًا، ${fmtB(U.size())}. لا يُحفظ أي نص من محادثاتك في السجل، ولا يُرسل شيء خارج جهازك. الأرقام الخاصة بالرموز <b>تقديرية</b> (≈ 3.2 حرف لكل رمز). الردود السابقة لبدء التسجيل تُحسب من محادثاتك المحفوظة (بلا بيانات زمن).</p>
      <div class="st-acts"><button type="button" class="lib-btn" data-st="exp-json">${ico('download')}تصدير JSON</button><button type="button" class="lib-btn" data-st="exp-csv">${ico('download')}تصدير CSV</button><button type="button" class="lib-btn dng" data-st="clear">${ico('trash')}مسح السجل</button></div>`);
  }

  /* ----- الملخص ----- */
  function viewSum(){
    const r = range(ui.per), g = gather(r.from, r.to), T = tstats(g), V = vstats(g), S = streaks();
    let pg = null; if (!r.all){ const len = r.to - r.from; pg = gather(r.from - len, r.from); }
    const PT = pg && tstats(pg), PV = pg && vstats(pg);
    const U = window.__usage, allReq = live(g.tx).filter(e => e.k === 'chat').length + g.img.length + live(g.tts.filter(e => !e.cache)).length + g.stt.length;
    const failReq = live(g.tx).filter(e => e.k === 'chat' && !e.ok).length + g.img.filter(e => !e.ok).length + g.tts.filter(e => !e.ok).length + g.stt.filter(e => !e.ok).length;
    const act = actChart(r, g), ins = insights(r, g, T, V), amap = activityMap();
    const total = T.replies + T.imgs + V.tts + V.stt || 1;
    const split = [['ردود نصية', T.replies], ['صور مولّدة', T.imgs], ['قراءة صوتية', V.tts], ['تفريغ صوتي', V.stt]].filter(x => x[1]);
    return `<div class="st-hero"><div class="st-flame">${ico('flame')}</div><div><b>${S.cur} ${S.cur === 1 ? 'يوم' : 'أيام'}</b><small>سلسلة النشاط الحالية · الأطول ${S.best} · ${S.active} يومًا نشطًا</small></div></div>
    <div class="st-kpis">
      ${kpi('ردود النماذج', fmtN(T.replies), 'نص وصور', pg ? delta(T.replies, PT.replies) : '')}
      ${kpi('رسائلك', fmtN(T.sent), `≈ ${fmtN(tok(T.uChars))} رمز`, pg ? delta(T.sent, PT.sent) : '')}
      ${kpi('طلبات الصوت', fmtN(V.tts + V.stt), `قراءة ${V.tts} · تفريغ ${V.stt}`, pg ? delta(V.tts + V.stt, PV.tts + PV.stt) : '')}
      ${kpi('رموز تقديرية', fmtN(T.tin + T.tout), `إدخال ${fmtN(T.tin)} · إخراج ${fmtN(T.tout)}`)}
      ${kpi('متوسط الاستجابة', fmtMs(T.avgMs), T.p90 ? 'P90 ' + fmtMs(T.p90) : '', pg ? delta(T.avgMs, PT.avgMs, true) : '')}
      ${kpi('نجاح الطلبات', allReq ? pct(allReq - failReq, allReq) + '%' : '—', failReq ? failReq + ' فشل' : 'بلا أخطاء')}
    </div>
    ${card('النشاط عبر الزمن', `<div class="st-lg top"><span><i class="b1"></i>نص وصور</span><span><i class="b2"></i>صوت</span></div>` + (allReq || T.replies ? act.html : empty('لا نشاط في هذه الفترة.')))}
    ${card('خريطة النشاط', heatmap(amap), `<small>آخر 15 أسبوعًا</small>`)}
    ${split.length ? card('توزيع الاستخدام', hbars(split.map(([l, n]) => [l, n, Math.max(...split.map(x => x[1])), n + ' · ' + pct(n, total) + '%']))) : ''}
    ${ins.length ? card('رؤى', `<div class="st-ins">${ins.map(([i, t]) => `<div>${ico(i)}<p>${t}</p></div>`).join('')}</div>`) : ''}
    ${dataCard()}`;
  }

  /* ----- النص ----- */
  function viewText(){
    const r = range(ui.per), g = gather(r.from, r.to), T = tstats(g), ev = chatEv(g), lv = live(ev);
    let pg = null; if (!r.all){ const len = r.to - r.from; pg = gather(r.from - len, r.from); }
    const P = pg && tstats(pg);
    const { list, step } = buckets(r);
    let chart = '';
    if (ui.met === 'req') chart = barChart(list.map(b => { const n = ev.filter(e => inB(b, e.ts)).length; return { l:blabel(b, step), tip:`${dlab(b.from)} · ${n} رد`, a:n }; }));
    else if (ui.met === 'tok') chart = `<div class="st-lg top"><span><i class="b1"></i>إخراج</span><span><i class="b2"></i>إدخال</span></div>` + barChart(list.map(b => { const x = ev.filter(e => inB(b, e.ts)); const o = sum(x, e => e.o), i = sum(x, e => e.i); return { l:blabel(b, step), tip:`${dlab(b.from)} · إخراج ${fmtN(o)} · إدخال ${fmtN(i)}`, a:o, b:i }; }));
    else chart = lineChart(list.map(b => { const a = avg(lv.filter(e => inB(b, e.ts) && e.ok && e.ms > 0).map(e => e.ms)); return { l:blabel(b, step), v:a, tip:`${dlab(b.from)} · متوسط ${fmtMs(a)}` }; }));
    const hrs = Array(24).fill(0); ev.forEach(e => hrs[new Date(e.ts).getHours()]++);
    const wd = Array(7).fill(0); ev.forEach(e => wd[new Date(e.ts).getDay()]++); const wmx = Math.max(1, ...wd);
    /* التأخير */
    const edges = [[0, 1000, 'أقل من 1 ث'], [1000, 2500, '1 – 2.5 ث'], [2500, 5000, '2.5 – 5 ث'], [5000, 10000, '5 – 10 ث'], [10000, 20000, '10 – 20 ث'], [20000, 1e12, 'أكثر من 20 ث']];
    const hist = edges.map(([a, b, l]) => [l, T.ms.filter(x => x >= a && x < b).length]), hmx = Math.max(1, ...hist.map(x => x[1]));
    /* النماذج */
    const byM = {};
    ev.forEach(e => { const k = (e.h || '') + '|' + e.m; (byM[k] = byM[k] || { m:e.m, h:e.h, a:[] }).a.push(e); });
    let rows = Object.values(byM).map(o => { const a = o.a, l = live(a).filter(e => e.ok && e.ms > 0);
      return { ...o, n:a.filter(e => e.ok).length, fail:live(a).filter(e => !e.ok).length, ms:avg(l.map(e => e.ms)), tt:avg(l.filter(e => e.tt).map(e => e.tt)), o:sum(a, e => e.o), th:a.filter(e => e.th > 0).length }; }).sort((a, b) => b.n - a.n);
    const topN = ui.allModels ? rows.length : 6, mmx = rows[0] ? rows[0].n : 1;
    const mrows = rows.slice(0, topN).map(o => `<div class="st-mrow"><div class="h"><b dir="ltr">${E(shortModel(o.m))}</b><span>${o.n} رد</span></div>
      <div class="bar"><u style="width:${Math.max(3, o.n / mmx * 100)}%"></u></div>
      <div class="m"><span>زمن <b dir="ltr">${fmtMs(o.ms)}</b></span><span>أول رمز <b dir="ltr">${fmtMs(o.tt)}</b></span><span>إخراج <b>${fmtN(o.o)}</b></span>${o.th ? `<span>تفكير <b>${o.th}</b></span>` : ''}${o.fail ? `<span class="bad">فشل <b>${o.fail}</b></span>` : ''}</div>${o.h ? `<small dir="ltr">${E(o.h)}</small>` : ''}</div>`).join('');
    const byH = {}; ev.forEach(e => { if (e.h) byH[e.h] = (byH[e.h] || 0) + 1; }); const hostRows = Object.entries(byH).sort((a, b) => b[1] - a[1]).slice(0, 6);
    /* المحادثات */
    const kept = chats.filter(c => !c.temp), msgsC = c => c.messages.filter(m => !m.error).length;
    const topChats = [...kept].sort((a, b) => msgsC(b) - msgsC(a)).slice(0, 5);
    /* الأخطاء */
    const errs = {}; g.tx.concat(g.img).filter(e => !e.ok && e.e).forEach(e => { const k = e.e.replace(/\d{3,}/g, '…').slice(0, 70); (errs[k] = errs[k] || { n:0, ts:0, m:e.m }).n++; errs[k].ts = Math.max(errs[k].ts, e.ts); });
    const errRows = Object.entries(errs).sort((a, b) => b[1].n - a[1].n).slice(0, 5);
    const metBtn = (k, l) => `<button type="button" class="${ui.met === k ? 'on' : ''}" data-met="${k}">${l}</button>`;
    return `<div class="st-kpis">
      ${kpi('ردود النماذج', fmtN(T.replies), T.fails ? T.fails + ' فشل' : 'بلا أخطاء', P ? delta(T.replies, P.replies) : '')}
      ${kpi('رسائلك', fmtN(T.sent), `متوسط ${T.sent ? Math.round(T.uChars / T.sent) : 0} حرف`, P ? delta(T.sent, P.sent) : '')}
      ${kpi('رموز الإدخال', fmtN(T.tin), 'تقديرية')}
      ${kpi('رموز الإخراج', fmtN(T.tout), T.tth ? 'منها تفكير ' + fmtN(T.tth) : 'تقديرية', P ? delta(T.tout, P.tout) : '')}
      ${kpi('متوسط الاستجابة', fmtMs(T.avgMs), 'الزمن الكلي', P ? delta(T.avgMs, P.avgMs, true) : '')}
      ${kpi('أول رمز (TTFT)', fmtMs(T.avgTt), 'زمن بدء الرد', P ? delta(T.avgTt, P.avgTt, true) : '')}
      ${kpi('سرعة التوليد', T.avgTps ? Math.round(T.avgTps) : '—', 'رمز / ثانية')}
      ${kpi('نجاح الطلبات', T.rate != null ? T.rate + '%' : '—', T.rate != null ? lv.length + ' طلبًا' : 'لا بيانات')}
      ${kpi('صور مولّدة', fmtN(T.imgs), T.imgFails ? T.imgFails + ' فشل' : '')}
      ${kpi('مرفقات أرسلتها', fmtN(T.files + T.upImgs), `${T.files} ملف · ${T.upImgs} صورة`)}
      ${kpi('ردود بتفكير', fmtN(T.thinkRep), pct(T.thinkRep, Math.max(1, T.replies)) + '% من الردود')}
      ${kpi('كتل أكواد', fmtN(g.codeBlocks), 'في ردود المساعد')}
    </div>
    ${card('النشاط', `<div class="st-seg" role="group">${metBtn('req', 'الردود')}${metBtn('tok', 'الرموز')}${metBtn('lat', 'زمن الاستجابة')}</div>` + (ev.length ? chart : empty('لا ردود في هذه الفترة.')))}
    ${ev.length ? card('ساعات النشاط', barChart(hrs.map((n, h) => ({ l:hlab(h), tip:`${hlab(h)} · ${n} رد`, a:n })), { h:120 })) : ''}
    ${ev.length ? card('أيام الأسبوع', hbars(wd.map((n, i) => [WD[i], n, wmx, n]))) : ''}
    ${T.ms.length ? card('توزيع زمن الاستجابة', `<div class="st-pc"><div><span>P50</span><b dir="ltr">${fmtMs(T.p50)}</b></div><div><span>P90</span><b dir="ltr">${fmtMs(T.p90)}</b></div><div><span>P95</span><b dir="ltr">${fmtMs(T.p95)}</b></div></div>` + hbars(hist.map(([l, n]) => [l, n, hmx, n]), 'sp')) : ''}
    ${rows.length ? card('أداء النماذج', `<div class="st-mrows">${mrows}</div>` + (rows.length > 6 ? `<button type="button" class="lib-btn st-more" data-st="more">${ui.allModels ? 'عرض أقل' : 'عرض الكل (' + rows.length + ')'}</button>` : '')) : ''}
    ${hostRows.length > 1 ? card('نقاط الاتصال', hbars(hostRows.map(([h, n]) => [h, n, hostRows[0][1], n + ' · ' + pct(n, ev.length) + '%'])), '') : ''}
    ${topChats.length ? card('أطول المحادثات', hbars(topChats.map(c => [c.title || 'محادثة', msgsC(c), msgsC(topChats[0]), msgsC(c) + ' رسالة'])) + `<p class="st-note">لديك ${kept.length} محادثة بمتوسط ${kept.length ? Math.round(sum(kept, msgsC) / kept.length) : 0} رسالة لكل محادثة.</p>`) : ''}
    ${errRows.length ? card('الأخطاء الأكثر تكرارًا', `<div class="st-errs">${errRows.map(([m, o]) => `<div><p dir="auto">${E(m)}</p><small>${o.n} مرة · ${E(shortModel(o.m))} · آخرها ${new Date(o.ts).toLocaleDateString(LOC, { day:'numeric', month:'short' })}</small></div>`).join('')}</div>`) : ''}
    ${T.titles || T.labs ? `<p class="st-note c">طلبات خلفية لم تُحتسب أعلاه: ${T.titles} عنوان تلقائي · ${T.labs} من ساحة التجربة والمقارنة.</p>` : ''}`;
  }

  /* ----- الصوت ----- */
  function viewVoice(){
    const r = range(ui.per), g = gather(r.from, r.to), V = vstats(g);
    let pg = null; if (!r.all){ const len = r.to - r.from; pg = gather(r.from - len, r.from); }
    const P = pg && vstats(pg);
    const { list, step } = buckets(r);
    const chart = barChart(list.map(b => { const t = g.tts.filter(e => inB(b, e.ts)).length, s = g.stt.filter(e => inB(b, e.ts)).length; return { l:blabel(b, step), tip:`${dlab(b.from)} · قراءة ${t} · تفريغ ${s}`, a:t, b:s }; }));
    const byP = {}; g.tts.forEach(e => { (byP[e.p] = byP[e.p] || { tts:[], stt:[] }).tts.push(e); }); g.stt.forEach(e => { (byP[e.p] = byP[e.p] || { tts:[], stt:[] }).stt.push(e); });
    const plab = p => (VOICE_PRESETS[p] || {}).label || p;
    const prow = Object.entries(byP).map(([p, o]) => { const l = live(o.tts.filter(e => !e.cache && e.ok && e.ms > 0)).map(e => e.ms), s = o.stt.filter(e => e.ok && e.ms > 0).map(e => e.ms);
      return { p, n:o.tts.length + o.stt.length, tts:o.tts.length, stt:o.stt.length, lat:avg(l), sl:avg(s), fail:o.tts.concat(o.stt).filter(e => !e.ok).length }; }).sort((a, b) => b.n - a.n);
    const vname = (p, id) => { try{ const v = ttsVoiceList(p).find(x => x.id === id); return v ? v.name : (id || '—'); }catch{ return id || '—'; } };
    const byV = {}; g.tts.filter(e => e.ok).forEach(e => { const k = e.p + '|' + e.v; (byV[k] = byV[k] || { p:e.p, v:e.v, n:0, c:0 }).n++; byV[k].c += e.c || 0; });
    const vrows = Object.values(byV).sort((a, b) => b.n - a.n).slice(0, 6);
    const src = { read:0, preview:0 }; g.tts.forEach(e => { if (e.ok) src[e.s === 'preview' ? 'preview' : 'read']++; });
    const hist = [[0, 800, 'أقل من 0.8 ث'], [800, 1500, '0.8 – 1.5 ث'], [1500, 3000, '1.5 – 3 ث'], [3000, 6000, '3 – 6 ث'], [6000, 1e12, 'أكثر من 6 ث']].map(([a, b, l]) => [l, V.lat.filter(x => x >= a && x < b).length]);
    const hmx = Math.max(1, ...hist.map(x => x[1]));
    const errs = {}; g.tts.concat(g.stt).filter(e => !e.ok && e.e).forEach(e => { const k = e.e.replace(/\d{4,}/g, '…').slice(0, 70); (errs[k] = errs[k] || { n:0, ts:0, p:e.p, t:e.t }).n++; errs[k].ts = Math.max(errs[k].ts, e.ts); });
    const errRows = Object.entries(errs).sort((a, b) => b[1].n - a[1].n).slice(0, 5);
    const tc = voiceConf('tts'), sc = voiceConf('stt');
    const stkeys = [...new Map([...voiceConnsFor('tts'), ...voiceConnsFor('stt')].map(c => [c.id, c])).values()];
    const keysHtml = stkeys.length ? `<div class="st-keys">${stkeys.map(c => { const k = keyRes[c.id]; return `<div><span>${E(voiceConnLabel(c))}</span><em class="${k ? (k.ok ? 'ok' : 'bad') : ''}">${k ? (k.busy ? 'يختبر…' : k.ok ? '✓ ' + fmtMs(k.ms) : '✕ ' + E(k.err)) : 'لم يُختبر'}</em></div>`; }).join('')}</div>
      <div class="st-acts"><button type="button" class="lib-btn" data-st="keys"${keyBusy ? ' disabled' : ''}>${ico('key')}${keyBusy ? 'يختبر…' : 'اختبار كل المفاتيح'}</button></div>` : empty('لا توجد مفاتيح صوت. أضفها من الإعدادات ← المفاتيح والنماذج ← مفاتيح الصوت.');
    const none = !g.tts.length && !g.stt.length;
    return `<div class="st-kpis">
      ${kpi('قراءة صوتية', fmtN(V.tts), V.cache ? `منها ${V.cache} من الذاكرة` : 'طلب ناجح', P ? delta(V.tts, P.tts) : '')}
      ${kpi('أحرف مقروءة', fmtN(V.chars), '≈ ' + fmtDur(V.secs), P ? delta(V.chars, P.chars) : '')}
      ${kpi('زمن التوليد', fmtMs(V.avgLat), V.p90 ? 'P90 ' + fmtMs(V.p90) : 'متوسط', P ? delta(V.avgLat, P.avgLat, true) : '')}
      ${kpi('نجاح القراءة', V.tRate != null ? V.tRate + '%' : '—', V.tFail ? V.tFail + ' فشل' : V.api + ' طلبًا')}
      ${kpi('حجم الصوت', fmtB(V.bytes), 'تم تنزيله')}
      ${kpi('ذاكرة مؤقتة', V.tts ? pct(V.cache, V.tts) + '%' : '—', 'طلبات بلا توليد')}
      ${kpi('تفريغ صوتي', fmtN(V.stt), V.sFail ? V.sFail + ' فشل' : 'تسجيل ناجح', P ? delta(V.stt, P.stt) : '')}
      ${kpi('أحرف مفرَّغة', fmtN(V.sChars), 'نص مُحوَّل')}
      ${kpi('زمن التفريغ', fmtMs(V.avgSl), 'متوسط')}
      ${kpi('نجاح التفريغ', V.sRate != null ? V.sRate + '%' : '—', fmtB(V.sBytes) + ' مرفوعة')}
    </div>
    ${card('النشاط الصوتي', `<div class="st-lg top"><span><i class="b1"></i>قراءة</span><span><i class="b2"></i>تفريغ</span></div>` + (none ? empty('لا نشاط صوتي في هذه الفترة. جرّب صفحة «الأصوات» أو اضغط أيقونة القراءة تحت أي رد.') : chart))}
    ${prow.length ? card('حسب المزوّد', hbars(prow.map(o => [plab(o.p), o.n, prow[0].n, o.n + (o.fail ? ' · ✕' + o.fail : ''), `قراءة ${o.tts} · تفريغ ${o.stt}${o.lat ? ' · ' + fmtMs(o.lat) : ''}`]))) : ''}
    ${vrows.length ? card('أكثر الأصوات استخدامًا', hbars(vrows.map(o => [vname(o.p, o.v), o.n, vrows[0].n, o.n + ' · ' + fmtN(o.c) + ' حرف', plab(o.p)])), '') : ''}
    ${src.read + src.preview ? card('مصدر القراءة', hbars([['قراءة ردود المحادثة', src.read, Math.max(src.read, src.preview), src.read], ['تجربة الأصوات', src.preview, Math.max(src.read, src.preview), src.preview]])) : ''}
    ${V.lat.length ? card('توزيع زمن التوليد', hbars(hist.map(([l, n]) => [l, n, hmx, n]), 'sp')) : ''}
    ${errRows.length ? card('أخطاء الصوت', `<div class="st-errs">${errRows.map(([m, o]) => `<div><p dir="auto">${E(m)}</p><small>${o.n} مرة · ${E(plab(o.p))} · ${o.t === 'stt' ? 'تفريغ' : 'قراءة'}</small></div>`).join('')}</div>`) : ''}
    ${card('الإعداد الحالي', `<div class="st-cfg"><div><span>القراءة</span><b dir="ltr">${E(plab(tc.p))} · ${E(vname(tc.p, tc.voice || tc.model))}</b></div><div><span>نموذج القراءة</span><b dir="ltr">${E(tc.model || '—')}</b></div><div><span>سرعة القراءة</span><b dir="ltr">×${Number(voiceCfg.tts.rate) || 1}</b></div><div><span>التفريغ</span><b dir="ltr">${E(plab(sc.p))} · ${E(sc.model || '—')}</b></div><div><span>لغة التفريغ</span><b>${E((STT_LANGS.find(l => l[0] === voiceCfg.stt.lang) || [0, voiceCfg.stt.lang])[1])}</b></div></div>
      <p class="st-note">مدة الصوت تقديرية (≈ 15 حرفًا في الثانية عند سرعة ×1).</p>`)}
    ${card('صحة مفاتيح الصوت', keysHtml)}`;
  }

  /* ----- النماذج (كانت «نظرة عامة» في صفحة النماذج) ----- */
  function viewModels(){
    const nUse = Object.values(modelUse).reduce((n, u) => n + (u.n || 0), 0);
    return `<p class="st-note c">كل ما كان في «نظرة عامة» بصفحة النماذج: النموذج الحالي، المقارنة، صحة الاتصال، الأسرع والأكثر استخدامًا، العائلات، المكرر، والنسخ الاحتياطي. إجمالي مرات اختيار النماذج: ${nUse}.</p>` + mdOverviewHtml();
  }

  /* ---------- الهيكل والرسم ---------- */
  function render(){
    const root = $('stRoot'); if (!root) return;
    if (!TABS.some(t => t[0] === ui.tab)) ui.tab = 'sum';
    let body = '';
    try{ body = ui.tab === 'text' ? viewText() : ui.tab === 'voice' ? viewVoice() : ui.tab === 'models' ? viewModels() : viewSum(); }
    catch(e){ console.error('stats', e); body = empty('تعذّر حساب الإحصائيات: ' + E(e.message)); }
    root.innerHTML = `<div class="st"><div class="vo-tabs st-tabs" role="tablist">${TABS.map(([k, l, i]) => `<button type="button" role="tab" class="vo-tab${ui.tab === k ? ' on' : ''}" data-tab-st="${k}" aria-selected="${ui.tab === k}">${ico(i)}<span>${l}</span></button>`).join('')}</div>
      ${ui.tab !== 'models' ? perChips() : ''}<div class="st-body">${body}</div></div>`;
  }
  const visible = () => mainEl.classList.contains('set-open') && curSetTab === 'stats';
  window.__stRefresh = () => { if (!visible() || timer) return; timer = setTimeout(() => { timer = 0; if (!visible()) return; const sb = document.querySelector('.set-body'), y = sb ? sb.scrollTop : 0; render(); if (sb) sb.scrollTop = y; }, 150); };
  window.__stOpen = render;
  window.__stSub = () => { try{ const U = window.__usage; return `${U.all().length} حدثًا مسجّلًا · النص والصوت والنماذج`; }catch{ return 'النص والصوت والنماذج'; } };

  /* ---------- تصدير ---------- */
  const csvEsc = v => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  function exportData(kind){
    const U = window.__usage, ev = U.all();
    if (!ev.length){ toast('لا يوجد سجل لتصديره بعد'); return; }
    const day = new Date().toISOString().slice(0, 10);
    if (kind === 'json') saveFile(new Blob([JSON.stringify({ app:'quark-ai-usage', v:1, since:U.since(), exportedAt:Date.now(), events:ev }, null, 2)], { type:'application/json' }), `quark-usage-${day}.json`);
    else {
      const head = ['time', 'type', 'kind', 'provider_or_host', 'model_or_voice', 'ok', 'ms', 'ttft_ms', 'in_tokens_est', 'out_tokens_est', 'chars', 'bytes', 'cached', 'error'];
      const rows = ev.map(e => [new Date(e.ts).toISOString(), e.t, e.k || e.s || '', e.h || e.p || '', e.m || e.v || '', e.ok ? 1 : 0, e.ms || '', e.tt || '', e.i || '', e.o || '', e.c || '', e.b || '', e.cache ? 1 : '', e.e || ''].map(csvEsc).join(','));
      saveFile(new Blob(['\ufeff' + head.join(',') + '\n' + rows.join('\n')], { type:'text/csv;charset=utf-8' }), `quark-usage-${day}.csv`);
    }
    toast('تم تصدير الإحصائيات');
  }
  async function testKeys(){
    if (keyBusy) return; keyBusy = true;
    const list = [...new Map([...voiceConnsFor('tts'), ...voiceConnsFor('stt')].map(c => [c.id, c])).values()];
    list.forEach(c => { keyRes[c.id] = { busy:true }; }); render();
    await Promise.all(list.map(async c => {
      const t0 = performance.now();
      try{ await voiceConnTest(c.preset, c.url, c.key); keyRes[c.id] = { ok:true, ms:performance.now() - t0 }; }
      catch(e){ keyRes[c.id] = { ok:false, err:e.message === 'Failed to fetch' ? 'تعذّر الاتصال' : String(e.message).slice(0, 60) }; }
    }));
    keyBusy = false; render();
  }

  /* ---------- الأحداث ---------- */
  document.addEventListener('click', async e => {
    const root = $('stRoot'); if (!root || !root.contains(e.target)) return;
    const t = e.target;
    const tb = t.closest('[data-tab-st]'); if (tb){ ui.tab = tb.dataset.tabSt; saveUi(); render(); const sb = document.querySelector('.set-body'); if (sb) sb.scrollTop = 0; return; }
    const pr = t.closest('[data-per]'); if (pr){ ui.per = pr.dataset.per; saveUi(); render(); return; }
    const mt = t.closest('[data-met]'); if (mt){ ui.met = mt.dataset.met; saveUi(); render(); return; }
    const hit = t.closest('.hit, .hm[data-tip]');
    if (hit){
      const ch = hit.closest('.st-chart'), rd = ch && ch.querySelector('.st-read');
      if (rd){ rd.textContent = hit.dataset.tip; rd.classList.add('on'); ch.querySelectorAll('.sel').forEach(x => x.classList.remove('sel')); hit.classList.add('sel'); }
      return;
    }
    const a = t.closest('[data-st]')?.dataset.st;
    if (a === 'more'){ ui.allModels = !ui.allModels; render(); }
    else if (a === 'exp-json') exportData('json');
    else if (a === 'exp-csv') exportData('csv');
    else if (a === 'keys') testKeys();
    else if (a === 'clear'){
      if (await qConfirm('سيُمسح سجل الاستخدام (الأزمنة والأخطاء وإحصائيات الصوت) ويبدأ من جديد. محادثاتك لن تُحذف. متابعة؟', { ok:'مسح السجل' })){ window.__usage.clear(); render(); toast('تم مسح سجل الإحصائيات'); }
    }
    else {
      /* أزرار «نظرة عامة» المنقولة: النموذج الحالي / الثاني / المقارنة */
      const b = t.closest('#stOv [data-a]'); if (!b) return;
      if (b.dataset.a === 'cmp') toggleCompare();
      else if (b.dataset.a === 'slotA'){ popTarget = 'A'; openPop(); }
      else if (b.dataset.a === 'slotB'){ popTarget = 'B'; openPop(); }
      setTimeout(() => { if (visible()) render(); }, 120);
    }
  });
})();
