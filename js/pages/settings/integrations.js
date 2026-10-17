/* QUARK AI — الإعدادات ← التكاملات: واجهات API وWebhooks الصادرة */
'use strict';

(function(){
  const E = v => esc(String(v == null ? '' : v));
  const root = () => $('intRoot');
  const sw = (id, on) => `<input type="checkbox" class="sw" id="${id}" ${on ? 'checked' : ''}>`;
  const keyMask = k => k ? '••••' + String(k).slice(-3) : 'بلا مفتاح';

  function sheet(html){
    const ov = document.createElement('div'); ov.className = 'it-ov';
    ov.innerHTML = `<div class="it-sheet" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(ov);
    return { ov, close:() => ov.remove(), q:id => ov.querySelector('#' + id) };
  }

  /* ================= الصفحة ================= */
  function render(){
    const r = root(); if (!r) return;
    const items = intDB.items, hooks = intDB.hooks;
    let h = `<div class="panel"><h3 class="it-h"><svg class="i"><use href="#i-plug"/></svg>تكاملات API</h3>
      <p class="it-p">اربط خدماتك (المنزل الذكي، GitHub، قوائم المهام…) ليتصرف النموذج فيها من المحادثة: يقرأ ويستعلم تلقائيًا، وأي طلب يغيّر بيانات (إضافة/تعديل/حذف) يعرض عليك أولًا لتوافق. تحتاج البوابة (serve.py أو تطبيق الأندرويد). مفاتيحك تبقى في هذا الجهاز وتُرسل إلى بوابتك مع كل استدعاء فقط.</p>
      <div class="it-row"><div><b>السماح للنموذج باستدعاء التكاملات</b><small>يُضاف وصف التكاملات المفعّلة إلى تعليمات النموذج في المحادثة.</small></div>${sw('intChat', intDB.chat)}</div></div>`;
    h += `<div class="panel"><h3 class="it-h">التكاملات المضبوطة</h3>` +
      (items.length ? items.map(i => `<div class="it-card${i.enabled ? '' : ' off'}" data-id="${E(i.id)}">
        <div class="it-top"><div><b>${E(i.name)}</b><small dir="ltr">${E(intHost(i.base_url) || i.base_url)}</small></div>${sw('en-' + i.id, i.enabled)}</div>
        <div class="it-tags"><span class="it-tag">${E(INT_AUTH[i.auth_type])}</span><span class="it-tag">${E(keyMask(i.api_key))}</span>${i.readonly ? '<span class="it-tag ok">قراءة فقط</span>' : ''}</div>
        <div class="it-acts"><button type="button" class="lib-btn" data-a="test" data-id="${E(i.id)}">اختبار</button><button type="button" class="lib-btn" data-a="edit" data-id="${E(i.id)}">تعديل</button><button type="button" class="lib-btn dng" data-a="del" data-id="${E(i.id)}">حذف</button></div>
        <div class="it-res" id="res-${E(i.id)}" hidden></div></div>`).join('') : '<div class="it-empty">لا توجد تكاملات بعد. أضف أول واحد من القوالب الجاهزة أو خدمة مخصصة.</div>') +
      `<button type="button" class="lib-btn pri" data-a="add">إضافة تكامل</button></div>`;
    h += `<div class="panel"><h3 class="it-h">Webhooks الصادرة</h3>
      <p class="it-p">أرسل أحداث المحادثة إلى خدمة خارجية (n8n، Zapier، خادمك…). كل طلب POST بصيغة JSON وموقَّع بـ HMAC-SHA256 في الترويسة X-Quark-Signature. العناوين العامة فقط، ولا تُعاد المحاولة عند الفشل، وتعمل أثناء استخدام التطبيق.</p>` +
      (hooks.length ? hooks.map(w => `<div class="it-card${w.enabled ? '' : ' off'}" data-id="${E(w.id)}">
        <div class="it-top"><div><b>${E(w.name)}</b><small dir="ltr">${E(intHost(w.url) || w.url)}</small></div>${sw('wen-' + w.id, w.enabled)}</div>
        <div class="it-tags">${w.events.map(e => `<span class="it-tag">${E(INT_EVENTS[e])}</span>`).join('') || '<span class="it-tag bad">بلا أحداث</span>'}${w.secret ? '<span class="it-tag ok">موقَّع</span>' : ''}${w.text ? '<span class="it-tag">مع النص</span>' : ''}${w.last ? `<span class="it-tag ${w.last.ok ? 'ok' : 'bad'}">${E(w.last.ok ? 'آخر إرسال ناجح' : 'آخر إرسال فشل')}</span>` : ''}</div>
        <div class="it-acts"><button type="button" class="lib-btn" data-a="wtest" data-id="${E(w.id)}">اختبار</button><button type="button" class="lib-btn" data-a="wedit" data-id="${E(w.id)}">تعديل</button><button type="button" class="lib-btn dng" data-a="wdel" data-id="${E(w.id)}">حذف</button></div>
        <div class="it-res${w.last && !w.last.ok ? ' bad' : ''}" id="wres-${E(w.id)}" ${w.last && !w.last.ok ? '' : 'hidden'}>${w.last && !w.last.ok ? E(w.last.msg) : ''}</div></div>`).join('') : '<div class="it-empty">لا توجد Webhooks.</div>') +
      `<button type="button" class="lib-btn" data-a="wadd">إضافة Webhook</button></div>`;
    r.innerHTML = h;
  }
  window.renderInt = render;
  window.__intHooksChanged = () => { if (root() && root().offsetParent) render(); };

  /* ================= اختبار تكامل ================= */
  const testSpec = i => {
    const P = INT_PRESETS[i.preset] || {};
    if (P.topic) return { method:'POST', path:'/', body:{ topic:i.topic, title:'QUARK AI', message:'اختبار الاتصال ✔' }, need:i.topic ? '' : 'أدخل موضوع ntfy (Topic) أولًا.' };
    if (P.noTest) return { method:'POST', path:'/', body:{ content:'اختبار الاتصال من QUARK AI' }, confirm:'سيُرسل هذا الاختبار رسالة حقيقية إلى القناة. متابعة؟' };
    return { method:(P.test && P.test.method) || 'GET', path:(P.test && P.test.path) || '/' };
  };
  async function runTest(i, show){
    const sp = testSpec(i);
    if (sp.need){ show(sp.need, false); return; }
    if (sp.confirm && !(await qConfirm(sp.confirm, { ok:'أرسل', danger:false }))) return;
    show('جارٍ الاختبار…', null);
    const r = await intCall(i, sp);
    if (r.error) return show(r.error, false);
    const ok = r.status >= 200 && r.status < 300;
    const why = ok ? '' : r.status === 401 || r.status === 403 ? ' — رُفضت المصادقة، تحقق من المفتاح ونوعه.' : r.status === 404 ? ' — المسار غير موجود، تحقق من عنوان الخدمة.' : r.status >= 300 && r.status < 400 ? ' — تحويل؛ استخدم العنوان النهائي للخدمة.' : '';
    show(`${ok ? 'يعمل ✔' : 'استجابت الخدمة'} (HTTP ${r.status}، ${r.ms} م.ث)${why}`, ok);
  }
  const paintRes = (el, msg, ok) => { if (!el) return; el.hidden = !msg; el.textContent = msg || ''; el.className = 'it-res' + (ok === true ? ' ok' : ok === false ? ' bad' : ''); };

  /* ================= نافذة إضافة/تعديل تكامل ================= */
  function integDialog(existing){
    const d = existing ? { ...existing } : { id:intId(), preset:'custom', enabled:true, auth_type:'bearer', readonly:false };
    const { ov, close, q } = sheet(`
      <h3>${existing ? 'تعديل التكامل' : 'إضافة تكامل'}</h3>
      <div class="it-body">
        ${existing ? '' : `<div class="it-pre" id="it_fPre">${Object.keys(INT_PRESETS).map(k => `<button type="button" data-p="${k}" class="${k === d.preset ? 'on' : ''}">${E(k === 'custom' ? 'مخصص' : INT_PRESETS[k].name)}</button>`).join('')}</div>`}
        <label class="it-f">الاسم<input class="fld" id="it_fName" value="${E(d.name || '')}" placeholder="مثال: منزلي"></label>
        <label class="it-f">عنوان الخدمة (Base URL)<input class="fld" id="it_fBase" dir="ltr" value="${E(d.base_url || '')}" placeholder="https://…"><small>بدون استعلام أو «#». مثال: http://192.168.1.5:8123</small></label>
        <div class="it-g2">
          <label class="it-f">المصادقة<select class="fld" id="it_fAuth">${Object.keys(INT_AUTH).map(k => `<option value="${k}">${E(INT_AUTH[k])}</option>`).join('')}</select></label>
          <label class="it-f" id="it_fHdrW">اسم الترويسة<input class="fld" id="it_fHdr" dir="ltr" value="${E(d.auth_header || '')}" placeholder="Authorization"></label>
          <label class="it-f" id="it_fParW">اسم المعامل<input class="fld" id="it_fPar" dir="ltr" value="${E(d.auth_param || '')}" placeholder="api_key"></label>
        </div>
        <label class="it-f" id="it_fKeyW"><span id="it_fKeyL">المفتاح / الرمز</span><input class="fld" id="it_fKey" type="password" dir="ltr" autocomplete="new-password" value="${E(d.api_key || '')}"><small id="it_fKeyH"></small></label>
        <label class="it-f" id="it_fTopW" hidden>موضوع ntfy (Topic)<input class="fld" id="it_fTop" dir="ltr" value="${E(d.topic || '')}"></label>
        <label class="it-f">وصف الواجهة للنموذج<textarea class="fld" id="it_fDesc" placeholder="اكتب نقاط النهاية المتاحة بالشكل: GET /مسار — وصف">${E(d.description || '')}</textarea><small>هذا النص يُقرأ للنموذج ليعرف ماذا يستدعي. كلما كان أدق كانت النتائج أفضل.</small></label>
        <div class="it-row"><div><b>قراءة فقط</b><small>يرفض أي طلب غير GET دون سؤالك.</small></div>${sw('it_fRO', d.readonly)}</div>
        <div class="it-res" id="it_fRes" hidden></div>
      </div>
      <div class="it-foot"><button type="button" class="lib-btn" data-a="x">إلغاء</button><button type="button" class="lib-btn" data-a="t">اختبار</button><button type="button" class="lib-btn pri" data-a="s">حفظ</button></div>`);
    q('it_fAuth').value = d.auth_type;
    const sync = () => {
      const a = q('it_fAuth').value, P = INT_PRESETS[d.preset] || {};
      q('it_fHdrW').hidden = a !== 'header'; q('it_fParW').hidden = a !== 'query'; q('it_fKeyW').hidden = a === 'none';
      q('it_fKeyL').textContent = a === 'basic' ? 'مستخدم:كلمة مرور' : 'المفتاح / الرمز';
      q('it_fKeyH').textContent = P.keyHint && a === 'header' ? 'قيمة المفتاح الكاملة بالشكل: ' + P.keyHint : '';
      q('it_fTopW').hidden = !P.topic;
    };
    const applyPreset = k => {
      const P = INT_PRESETS[k]; d.preset = k;
      q('it_fPre')?.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.p === k));
      if (!q('it_fName').value.trim() || Object.values(INT_PRESETS).some(x => x.name && x.name === q('it_fName').value.trim())) q('it_fName').value = P.name;
      const real = P.base && !/example\.com|\.local|ID\/TOKEN/.test(P.base);          /* العناوين العامة الحقيقية تُملأ، والمثالية تبقى تلميحًا */
      q('it_fBase').placeholder = P.base || 'https://…'; if (!existing) q('it_fBase').value = real ? P.base : '';
      q('it_fAuth').value = P.auth_type; q('it_fHdr').value = P.auth_header || ''; q('it_fDesc').value = P.description || '';
      sync();
    };
    q('it_fAuth').addEventListener('change', sync);
    sync();
    const read = () => intNormInteg({ id:d.id, name:q('it_fName').value, preset:d.preset, base_url:q('it_fBase').value, auth_type:q('it_fAuth').value, auth_header:q('it_fHdr').value.trim(), auth_param:q('it_fPar').value.trim(),
      api_key:q('it_fKey').value, description:q('it_fDesc').value, enabled:d.enabled, readonly:q('it_fRO').checked, topic:q('it_fTop').value.trim() });
    const check = x => { if (!x){ toast('أدخل اسم التكامل'); return false; } const e = intCheckBase(x.base_url); if (e){ toast(e); return false; } if (x.auth_type === 'header' && !x.auth_header){ toast('أدخل اسم ترويسة المصادقة'); return false; } return true; };
    ov.addEventListener('click', async e => {
      if (e.target === ov) return close();
      const pb = e.target.closest('[data-p]'); if (pb) return applyPreset(pb.dataset.p);
      const b = e.target.closest('[data-a]'); if (!b) return;
      if (b.dataset.a === 'x') return close();
      const x = read(); if (!check(x)) return;
      if (b.dataset.a === 't'){ b.disabled = true; try{ await runTest(x, (m, ok) => paintRes(q('it_fRes'), m, ok)); } finally { b.disabled = false; } return; }
      if (b.dataset.a === 's'){
        const i = intDB.items.findIndex(y => y.id === x.id); if (i >= 0) intDB.items[i] = x; else intDB.items.push(x);
        intSave(); close(); render(); toast('حُفظ التكامل');
      }
    });
  }

  /* ================= نافذة Webhook ================= */
  const genSecret = () => { const a = new Uint8Array(24); crypto.getRandomValues(a); return Array.from(a, b => b.toString(16).padStart(2, '0')).join(''); };
  function hookDialog(existing){
    const d = existing ? { ...existing } : { id:intId(), enabled:true, events:['chat.completed'], text:false, secret:genSecret() };
    const { ov, close, q } = sheet(`
      <h3>${existing ? 'تعديل Webhook' : 'إضافة Webhook'}</h3>
      <div class="it-body">
        <label class="it-f">الاسم<input class="fld" id="it_wName" value="${E(d.name || '')}" placeholder="مثال: n8n"></label>
        <label class="it-f">العنوان (URL)<input class="fld" id="it_wUrl" dir="ltr" value="${E(d.url || '')}" placeholder="https://…"><small>عنوان عام فقط. العناوين الداخلية ومحلية الشبكة محجوبة.</small></label>
        <label class="it-f">سرّ التوقيع<div style="display:flex;gap:8px"><input class="fld" id="it_wSec" dir="ltr" value="${E(d.secret || '')}" style="flex:1"><button type="button" class="lib-btn" data-a="gen">توليد</button></div><small>يُستخدم للتحقق من أن الطلب منك: sha256 على «الطابع الزمني.الجسم».</small></label>
        <div class="it-ev"><small>الأحداث:</small>${Object.keys(INT_EVENTS).filter(k => k !== 'webhook.test').map(k => `<label><input type="checkbox" class="sw sm" data-ev="${k}" ${d.events.includes(k) ? 'checked' : ''}>${E(INT_EVENTS[k])} <small dir="ltr">${k}</small></label>`).join('')}</div>
        <div class="it-row"><div><b>تضمين نص الرسائل</b><small>إيقافه يرسل بيانات وصفية فقط (المعرّف والعنوان والنموذج) دون محتوى محادثتك.</small></div>${sw('it_wTxt', d.text)}</div>
        <div class="it-res" id="it_wRes" hidden></div>
      </div>
      <div class="it-foot"><button type="button" class="lib-btn" data-a="x">إلغاء</button><button type="button" class="lib-btn" data-a="t">اختبار</button><button type="button" class="lib-btn pri" data-a="s">حفظ</button></div>`);
    const read = () => intNormHook({ id:d.id, name:q('it_wName').value, url:q('it_wUrl').value, secret:q('it_wSec').value.trim(), events:[...ov.querySelectorAll('[data-ev]:checked')].map(c => c.dataset.ev), enabled:d.enabled, text:q('it_wTxt').checked, last:d.last });
    const check = x => { if (!x){ toast('أدخل عنوان الـ Webhook'); return false; } if (!/^https?:\/\//i.test(x.url)){ toast('يجب أن يبدأ العنوان بـ http:// أو https://'); return false; } return true; };
    ov.addEventListener('click', async e => {
      if (e.target === ov) return close();
      const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a;
      if (a === 'x') return close();
      if (a === 'gen'){ q('it_wSec').value = genSecret(); return; }
      const x = read(); if (!check(x)) return;
      if (a === 't'){ b.disabled = true; paintRes(q('it_wRes'), 'جارٍ الإرسال…', null); const r = await intSendHook({ ...x }, 'webhook.test', { message:'اختبار من QUARK AI' }); paintRes(q('it_wRes'), r.ok ? `وصل الاختبار ✔ (${r.msg})` : 'فشل: ' + r.msg, r.ok); b.disabled = false; return; }
      if (a === 's'){
        if (!x.name || x.name === 'Webhook') x.name = intHost(x.url);
        const i = intDB.hooks.findIndex(y => y.id === x.id); if (i >= 0) intDB.hooks[i] = x; else intDB.hooks.push(x);
        intSave(); close(); render(); toast('حُفظ الـ Webhook');
      }
    });
  }

  /* ================= أحداث الصفحة ================= */
  document.addEventListener('change', e => {
    const t = e.target; if (!root() || !root().contains(t)) return;
    if (t.id === 'intChat'){ intDB.chat = t.checked; intSave(); return; }
    const m = /^(w?)en-(.+)$/.exec(t.id); if (!m) return;
    const list = m[1] ? intDB.hooks : intDB.items, x = list.find(y => y.id === m[2]); if (!x) return;
    x.enabled = t.checked; intSave(); t.closest('.it-card')?.classList.toggle('off', !x.enabled);
  });
  document.addEventListener('click', async e => {
    if (!root() || !root().contains(e.target)) return;
    const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a, id = b.dataset.id;
    if (a === 'add') return integDialog(null);
    if (a === 'wadd') return hookDialog(null);
    if (a === 'edit') return integDialog(intDB.items.find(x => x.id === id));
    if (a === 'wedit') return hookDialog(intDB.hooks.find(x => x.id === id));
    if (a === 'del'){ const x = intDB.items.find(y => y.id === id); if (x && await qConfirm(`حذف التكامل «${x.name}»؟`, { ok:'حذف' })){ intDB.items = intDB.items.filter(y => y.id !== id); intSave(); render(); } return; }
    if (a === 'wdel'){ const x = intDB.hooks.find(y => y.id === id); if (x && await qConfirm(`حذف الـ Webhook «${x.name}»؟`, { ok:'حذف' })){ intDB.hooks = intDB.hooks.filter(y => y.id !== id); intSave(); render(); } return; }
    if (a === 'test'){ const x = intDB.items.find(y => y.id === id); if (!x) return; b.disabled = true; try{ await runTest(x, (m, ok) => paintRes($('res-' + id), m, ok)); } finally { b.disabled = false; } return; }
    if (a === 'wtest'){ const x = intDB.hooks.find(y => y.id === id); if (!x) return; b.disabled = true; paintRes($('wres-' + id), 'جارٍ الإرسال…', null); const r = await intSendHook(x, 'webhook.test', { message:'اختبار من QUARK AI' }); paintRes($('wres-' + id), r.ok ? `وصل الاختبار ✔ (${r.msg})` : 'فشل: ' + r.msg, r.ok); b.disabled = false; }
  });

  /* ================= شارات الاستدعاءات تحت رد النموذج ================= */
  window.__intDecorate = (w, m) => {
    if (!Array.isArray(m.api) || !m.api.length || w.querySelector('.it-api')) return;
    const d = document.createElement('div'); d.className = 'it-api';
    d.innerHTML = m.api.map(x => { const ok = /^[23]\d\d$/.test(x.s); return `<span class="it-chip ${ok ? 'ok' : 'bad'}" title="${E(x.n + ' ' + x.m + ' ' + x.p)}"><svg class="i"><use href="#i-plug"/></svg><span>${E(x.n)} · ${E(x.m)} ${E(x.p)}</span><b>${E(x.s)}</b></span>`; }).join('');
    const bub = w.querySelector('.bubble'); if (bub) bub.after(d); else w.appendChild(d);
  };
})();
