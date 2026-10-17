/* QUARK AI — البحث العميق: قارئ التقرير، المتابعة، وتبويب الإعدادات (السجل في المكتبة والتشغيل من المحادثة) */
'use strict';

/* نص مرحلة البحث (يُستخدم هنا وفي المحادثة) */
window.rsPhaseText = p => {
  if (!p || !p.phase) return 'جارٍ البدء…';
  const rn = p.round ? (p.maxRounds ? `الجولة ${p.round}/${p.maxRounds}: ` : `الجولة ${p.round}: `) : '';
  switch (p.phase){
    case 'planning': return 'يخطّط لاستراتيجية البحث…';
    case 'searching': return `${rn}بحث (${p.queries || 0} استعلامات)`;
    case 'reading': return `${rn}قراءة المصادر (${p.sources || 0})`;
    case 'analyzing': return `${rn}تحليل ${p.findings || 0} معلومة`;
    case 'writing': return `يكتب التقرير النهائي — ${p.sources || 0} مصدرًا`;
    default: return p.phase;
  }
};
const rsClock = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const rsTitleOf = q => rsCut(String(q).replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim() || String(q), 80);

/* حوار إدخال نص بسيط */
function rsAsk1(title, placeholder, ok = 'ابدأ'){
  return new Promise(res => {
    const ov = document.createElement('div'); ov.className = 'lib-ov q-confirm show';
    ov.innerHTML = `<div class="lib-dlg q-dlg" role="dialog" aria-modal="true"><h2>${esc(title)}</h2><textarea class="fld" rows="3" style="width:100%;height:auto;padding:10px;line-height:1.8" placeholder="${esc(placeholder)}"></textarea><div class="lib-acts"><button type="button" class="lib-btn" data-v="0">إلغاء</button><button type="button" class="lib-btn pri" data-v="1">${esc(ok)}</button></div></div>`;
    const done = v => { ov.remove(); res(v); };
    ov.addEventListener('click', e => { if (e.target === ov) done(null); const b = e.target.closest('[data-v]'); if (b) done(b.dataset.v === '1' ? ov.querySelector('textarea').value.trim() : null); });
    document.body.appendChild(ov); setTimeout(() => ov.querySelector('textarea').focus(), 50);
  });
}

(() => {
  const fold = x => String(x).replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').toLowerCase();
  void fold;
  const parseSel = v => { const i = String(v || '').indexOf('|'); return i > 0 ? { ep:v.slice(0, i), model:v.slice(i + 1) } : null; };
  const modelOptions = () => {
    let h = '<option value="">نموذج المحادثة الحالي</option>';
    settings.endpoints.filter(e => e.enabled).forEach(ep => {
      const ms = ep.models.filter(m => m.on && !isImgModel(ep, m.id));
      if (ms.length) h += `<optgroup label="${esc(hostOf(ep.url))}">` + ms.map(m => `<option value="${esc(ep.id + '|' + m.id)}">${esc(shortModel(m.id))}</option>`).join('') + '</optgroup>';
    });
    return h;
  };

  /* ---------- القارئ ---------- */
  function openReader(id){
    const r = rsDB.get(id); if (!r) return;
    const ov = document.createElement('div'); ov.className = 'rs-ov';
    ov.innerHTML = `<div class="rs-ovh"><button class="lib-ib" data-x aria-label="إغلاق">${ic('x')}</button><h3 dir="auto">${esc(r.title)}</h3><button class="lib-ib" data-copy title="نسخ">${ic('copy')}</button><button class="lib-ib" data-dl title="تنزيل .md">${ic('download')}</button></div>
      <div class="rs-ovb"><div class="rs-doc"><div class="rs-meta" style="margin-bottom:10px"><span class="tag">${esc(RS_CATS[r.category] || 'عام')}</span>${r.partial ? '<span class="tag mute">تقرير جزئي</span>' : ''}<span>${r.stats?.sources || 0} مصدرًا</span><span>${r.stats?.rounds || 0} جولات</span><span>${r.stats?.secs ? rsClock(r.stats.secs) : ''}</span><span>${esc(r.model || '')}</span></div>
      <div class="rs-toc" hidden></div><div class="rs-imgs" hidden></div><div class="ans"></div></div>
      <div class="rs-foot"><button class="lib-btn pri" data-a="discuss">ناقش في محادثة</button><button class="lib-btn" data-a="more">تابع البحث</button><button class="lib-btn danger" data-a="del">حذف</button></div></div>`;
    const ans = ov.querySelector('.ans'); ans.innerHTML = markdown(r.report);
    const hs = [...ans.querySelectorAll('h1,h2,h3')];
    if (hs.length >= 3){
      const toc = ov.querySelector('.rs-toc'); toc.hidden = false;
      toc.innerHTML = '<b>المحتويات</b>' + hs.map((h, i) => { h.id = 'rsh' + i; return `<a class="l${h.tagName[1]}" data-h="rsh${i}">${esc(h.textContent)}</a>`; }).join('');
    }
    const paintImgs = () => {
      const box = ov.querySelector('.rs-imgs'), imgs = (r.sources || []).filter(s => s.img && !(r.hidden || []).includes(s.img)).slice(0, 8);
      box.hidden = !imgs.length;
      box.innerHTML = imgs.map(s => `<figure><img loading="lazy" referrerpolicy="no-referrer" src="${esc(s.img)}" alt="" onerror="this.closest('figure').remove()"><button type="button" data-hide="${esc(s.img)}" aria-label="إخفاء الصورة">×</button></figure>`).join('');
    };
    paintImgs();
    const close = () => { document.removeEventListener('keydown', onKey, true); ov.remove(); };
    const onKey = e => { if (e.key === 'Escape'){ e.stopImmediatePropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('click', async e => {
      const t = e.target;
      if (t.closest('[data-x]')) return close();
      const h = t.closest('[data-h]'); if (h){ ov.querySelector('#' + h.dataset.h)?.scrollIntoView({ behavior:'smooth', block:'start' }); return; }
      const hd = t.closest('[data-hide]'); if (hd){ (r.hidden = r.hidden || []).push(hd.dataset.hide); rsDB.save(); paintImgs(); return; }
      if (t.closest('[data-copy]')){ try{ await navigator.clipboard.writeText(r.report); toast('تم نسخ التقرير'); }catch{ toast('تعذّر النسخ'); } return; }
      if (t.closest('[data-dl]')){ saveFile(new Blob([`# ${r.title}\n\n${r.report}\n`], { type:'text/markdown;charset=utf-8' }), (r.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'research') + '.md'); return; }
      const a = t.closest('[data-a]')?.dataset.a;
      if (a === 'discuss'){ close(); discuss(r); }
      else if (a === 'del'){ if (await qConfirm('حذف هذا التقرير نهائيًا؟', { ok:'حذف' })){ rsDB.del(r.id); close(); window.__libRefresh?.(); toast('تم الحذف'); } }
      else if (a === 'more'){
        const q = await rsAsk1('تابع البحث', 'ما الذي تريد التعمّق فيه أكثر؟'); if (!q) return;
        close(); startFollowUp(r, q);
      }
    });
    document.body.appendChild(ov);
  }
  window.rsOpenReader = openReader;

  window.rsOpenReader = openReader;

  /* متابعة بحث سابق: تُفتح محادثة فيها التقرير السابق ثم يُشغَّل بحث جديد يبني عليه */
  function startFollowUp(r, q){
    if (busy){ toast('انتظر انتهاء الرد الحالي'); return; }
    const now = Date.now();
    const c = { id:uid(), title:'متابعة: ' + rsCut(r.title, 34), ts:now, messages:[
      { role:'user', content:'ناقش معي تقرير البحث العميق التالي: ' + r.title },
      { role:'assistant', content:r.report, model:r.model, ts:now, research:{ id:r.id, sources:r.stats?.sources || 0, secs:r.stats?.secs || 0 } },
      { role:'user', content:q } ] };
    chats.unshift(c); currentId = c.id; incog = false; save(); showChatView(); renderAll();
    if (window.__rsChatRun) window.__rsChatRun(c); else toast('تعذّر بدء المتابعة');
  }
  window.rsStartFollowUp = startFollowUp;

  function discuss(r){
    const c = { id:uid(), title:'نقاش: ' + rsCut(r.title, 36), ts:Date.now(), messages:[
      { role:'user', content:'ناقش معي تقرير البحث العميق التالي: ' + r.title },
      { role:'assistant', content:r.report, model:r.model, ts:Date.now(), research:{ id:r.id, sources:r.stats?.sources || 0, secs:r.stats?.secs || 0 } } ] };
    chats.unshift(c); currentId = c.id; incog = false; save(); showChatView(); renderAll(); el.input.focus();
  }

  /* ---------- تبويب الإعدادات ---------- */
  const root = $('rsSetRoot');
  const PNAME = p => (RS_PROVIDERS[p] || p).split(' (')[0];
  const COUNTS = [3, 5, 8, 10, 15, 20];
  function bindRoot(){
    const c = settings.research;
    root.addEventListener('change', e => {
      const fb = e.target.closest('[data-fb]');
      if (fb){ root._commit(); c.fallbacks[+fb.dataset.fb] = fb.value; persistSettings(); renderSet(); return; }
      if (e.target.id !== 'rsP') root._commit();
    });
    root.addEventListener('click', e => {
      if (e.target.closest('#rsAddFb')){ root._commit(); const f = Object.keys(RS_PROVIDERS).find(k => ![c.provider, ...c.fallbacks].includes(k)); if (f){ c.fallbacks.push(f); persistSettings(); renderSet(); } return; }
      const r = e.target.closest('[data-rmfb]'); if (r){ root._commit(); c.fallbacks.splice(+r.dataset.rmfb, 1); persistSettings(); renderSet(); }
    });
  }
  function renderSet(){
    if (!root) return;
    const c = settings.research;
    const chain = [c.provider, ...c.fallbacks];
    /* حقول الاعتماد: لكل مزوّد في السلسلة ما يحتاجه (مفتاح / عنوان / CX) */
    const cred = [];
    chain.forEach(p => {
      if (RS_KEYED.includes(p)) cred.push(`<label><small>مفتاح ${esc(PNAME(p))}</small><input class="fld" data-k="${p}" type="password" dir="ltr" autocomplete="off" spellcheck="false" value="${esc(c.keys[p] || '')}"></label>`);
      if (p === 'google_pse') cred.push(`<label><small>معرّف محرك Google PSE (CX)</small><input class="fld" id="rsCx" type="text" dir="ltr" autocomplete="off" spellcheck="false" value="${esc(c.cx)}"></label>`);
      if (p === 'searxng') cred.push(`<label><small>عنوان SearXNG (يجب تفعيل صيغة JSON)</small><input class="fld" id="rsSx" type="text" dir="ltr" autocomplete="off" placeholder="http://localhost:8080" value="${esc(c.searxUrl)}"></label>`);
    });
    const provOpts = (cur, taken) => Object.keys(RS_PROVIDERS).filter(k => k === cur || !taken.includes(k)).map(k => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(RS_PROVIDERS[k])}</option>`).join('');
    const custom = !COUNTS.includes(c.resultCount);
    root.innerHTML = `<div class="rs-set rs-set-tab">
      <h3 class="rs-h">بحث الويب</h3>
      <div class="hint2">المحرك المستخدم في «بحث في الويب» داخل المحادثة وفي البحث العميق (ما لم تحدد للبحث العميق محركًا آخر).</div>
      <label><small>محرك البحث</small><select class="fld" id="rsP">${provOpts(c.provider, c.fallbacks)}</select></label>
      <label><small>عدد النتائج لكل استعلام</small><div class="rs-cnt-row"><select class="fld" id="rsCount">${COUNTS.map(n => `<option value="${n}"${!custom && n === c.resultCount ? ' selected' : ''}>${n}</option>`).join('')}<option value="custom"${custom ? ' selected' : ''}>مخصص</option></select><input class="fld" id="rsCountC" type="number" min="1" max="20" value="${c.resultCount}"${custom ? '' : ' hidden'}></div></label>
      ${cred.join('')}
      <div class="df-fb"><div class="df-fbh">محركات احتياطية — تُجرَّب بالترتيب عند فشل المحرك الأساسي أو بلوغ حدّ الطلبات أو غياب النتائج</div>
        ${c.fallbacks.map((f, i) => `<div class="df-fbr"><div class="sel-wrap"><select class="fld" data-fb="${i}">${provOpts(f, [c.provider, ...c.fallbacks])}</select>${ic('chevron-down', 'caret')}</div><button type="button" class="df-x" data-rmfb="${i}" aria-label="حذف">${ic('x')}</button></div>`).join('')}
        ${c.fallbacks.length < 4 && Object.keys(RS_PROVIDERS).some(k => !chain.includes(k)) ? `<button type="button" class="df-add" id="rsAddFb">${ic('plus')}<span>إضافة محرك احتياطي</span></button>` : ''}
      </div>
      <button type="button" class="lib-btn" id="rsTest" style="height:42px">اختبار البحث</button>
      <div class="hint2" id="rsTestOut"></div>
      <h3 class="rs-h">البحث العميق</h3>
      <label><small>محرك البحث العميق</small><select class="fld" id="rsDrP"><option value="">نفس بحث الويب</option>${Object.keys(RS_PROVIDERS).map(k => `<option value="${k}"${c.drProvider === k ? ' selected' : ''}>${esc(RS_PROVIDERS[k])}</option>`).join('')}</select></label>
      <label><small>نموذج البحث العميق</small><select class="fld" id="rsDefModel"></select></label>
      <div class="row2"><label><small>أقصى رموز للتقرير</small><input class="fld" id="rsMaxT" type="number" min="1024" max="64000" step="1024"></label>
      <label><small>التوازي في القراءة</small><input class="fld" id="rsConc" type="number" min="1" max="8"></label></div>
      <div class="row2"><label><small>مهلة الصفحة الواحدة (ث)</small><input class="fld" id="rsExT" type="number" min="10" max="600"></label>
      <label><small>مهلة البحث الكلية (ث، 0 = بلا حد)</small><input class="fld" id="rsRunT" type="number" min="0" max="21600"></label></div>
      <div class="hint2" id="rsGwNote"></div>
      <div class="hint2">من قائمة (+) في المحادثة: «بحث في الويب» للإجابة بمعلومات حديثة، و«بحث عميق» لتقرير موثّق كامل (تجد تقاريرك في المكتبة).<br>المفاتيح تُحفظ في هذا الجهاز فقط وتُرسل إلى البوابة وقت البحث. جلب الصفحات يرفض عناوين الشبكة الداخلية لحمايتك.</div>
    </div>`;
    const $o = id => root.querySelector('#' + id);
    $o('rsMaxT').value = c.maxTokens; $o('rsConc').value = c.concurrency; $o('rsExT').value = c.extractTimeout; $o('rsRunT').value = c.runTimeout;
    $o('rsDefModel').innerHTML = modelOptions(); $o('rsDefModel').value = c.sel ? c.sel.ep + '|' + c.sel.model : '';
    gwReady().then(ok => { const n = $o('rsGwNote'); if (n) n.innerHTML = ok ? '' : 'البحث العميق يحتاج البوابة لجلب الصفحات. شغّل <b dir="ltr">python3 serve.py</b> أو أدخل عنوان البوابة في الإعدادات (في تطبيق الأندرويد تعمل مدمجة).'; });
    const num = (id, lo, hi, d) => { const v = Number($o(id).value); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d; };
    const commit = () => {
      root.querySelectorAll('[data-k]').forEach(i => { c.keys[i.dataset.k] = i.value.trim(); });
      if ($o('rsSx')) c.searxUrl = $o('rsSx').value.trim();
      if ($o('rsCx')) c.cx = $o('rsCx').value.trim();
      c.resultCount = $o('rsCount').value === 'custom' ? num('rsCountC', 1, 20, 8) : Number($o('rsCount').value);
      c.sel = parseSel($o('rsDefModel').value); c.drProvider = $o('rsDrP').value;
      c.maxTokens = num('rsMaxT', 1024, 64000, 8192); c.concurrency = num('rsConc', 1, 8, 3); c.extractTimeout = num('rsExT', 10, 600, 90); c.runTimeout = num('rsRunT', 0, 21600, 1800);
      persistSettings();
    };
    $o('rsP').addEventListener('change', () => { commit(); c.provider = $o('rsP').value; c.fallbacks = c.fallbacks.filter(f => f !== c.provider); persistSettings(); renderSet(); });
    $o('rsDrP').addEventListener('change', () => root._commit());
    $o('rsCount').addEventListener('change', () => { $o('rsCountC').hidden = $o('rsCount').value !== 'custom'; commit(); });
    root._commit = commit;
    if (!root._bound){ root._bound = true; bindRoot(); }
    $o('rsTest').addEventListener('click', async () => {
      commit(); const out = $o('rsTestOut'); out.textContent = 'جارٍ الاختبار…';
      const lines = [];
      for (const p of [c.provider, ...c.fallbacks]){
        if (!rsProvReady(c, p)){ lines.push(`${PNAME(p)}: ينقصه ${rsProvMissing(c, p)}`); continue; }
        try{ const j = await rsGw('search', { query:'QUARK AI', provider:p, key:c.keys[p] || '', url:c.searxUrl, cx:c.cx, max_results:c.resultCount }); lines.push(`${PNAME(p)}: نجح (${j.results.length} نتيجة)`); }
        catch(err){ lines.push(`${PNAME(p)}: فشل — ${err.message}`); }
        out.innerHTML = lines.map(esc).join('<br>') + '<br>…';
      }
      out.innerHTML = lines.map(esc).join('<br>');
    });
  }
  window.renderRsSet = renderSet;
  window.__rsSub = () => (RS_PROVIDERS[settings.research.provider] || '').split(' (')[0];
})();
