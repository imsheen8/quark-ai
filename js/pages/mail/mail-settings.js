/* QUARK AI — إعدادات البريد: الحسابات، الرد التلقائي، تنظيف النشرات، الوسوم، الصور، أسلوب الكتابة */
'use strict';

(function(){
  const E = v => esc(String(v == null ? '' : v));
  const errMsg = e => (e && e.message) || 'حدث خطأ غير متوقع';
  const sw = (id, on) => `<input type="checkbox" class="sw" id="${id}" ${on ? 'checked' : ''}>`;
  let host = null, selId = '';
  const cur = () => mlAcct(selId) || mlActive() || mlAccounts()[0] || null;
  const ovOpen = html => { const ov = document.createElement('div'); ov.className = 'ml-ov'; ov.innerHTML = `<div class="ml-sheet">${html}</div>`; document.body.appendChild(ov); return { ov, close:() => ov.remove() }; };

  /* ================= نافذة الحساب ================= */
  window.mlAccountDialog = function(existing, done){
    const a = existing ? { ...existing } : { id:mlNewId(), provider:'gmail', imap_port:993, imap_sec:'ssl', smtp_port:465, smtp_sec:'ssl', enabled:true };
    const { ov, close } = ovOpen(`
      <h3>${existing ? 'تعديل الحساب' : 'إضافة حساب بريد'}</h3>
      <div class="ml-sh-body">
        <label class="ml-f">المزوّد<select class="fld" id="aProv">${Object.keys(ML_PROVIDERS).map(k => `<option value="${k}">${E(ML_PROVIDERS[k].label)}</option>`).join('')}</select></label>
        <div class="ml-hint" id="aHelp"></div>
        <label class="ml-f">البريد الإلكتروني<input class="fld" id="aUser" type="email" dir="ltr" autocomplete="off" value="${E(a.user || '')}"></label>
        <label class="ml-f">كلمة المرور (أو كلمة مرور التطبيق)<input class="fld" id="aPass" type="password" dir="ltr" autocomplete="new-password" value="${E(a.pass || '')}"></label>
        <div class="ml-grid">
          <label class="ml-f">اسم الحساب<input class="fld" id="aName" type="text" value="${E(a.name || '')}" placeholder="عمل، شخصي…"></label>
          <label class="ml-f">اسمك عند الإرسال<input class="fld" id="aDisp" type="text" value="${E(a.display || '')}"></label>
        </div>
        <div id="aAdv">
          <div class="ml-grid">
            <label class="ml-f">خادم IMAP<input class="fld" id="aIh" dir="ltr" value="${E(a.imap_host || '')}"></label>
            <label class="ml-f">المنفذ<input class="fld" id="aIp" type="number" dir="ltr" value="${E(a.imap_port)}"></label>
            <label class="ml-f">الأمان<select class="fld" id="aIs"><option value="ssl">SSL/TLS</option><option value="starttls">STARTTLS</option><option value="none">بدون</option></select></label>
          </div>
          <div class="ml-grid" style="margin-top:10px">
            <label class="ml-f">خادم SMTP<input class="fld" id="aSh" dir="ltr" value="${E(a.smtp_host || '')}"></label>
            <label class="ml-f">المنفذ<input class="fld" id="aSp" type="number" dir="ltr" value="${E(a.smtp_port)}"></label>
            <label class="ml-f">الأمان<select class="fld" id="aSs"><option value="ssl">SSL/TLS</option><option value="starttls">STARTTLS</option><option value="none">بدون</option></select></label>
          </div>
          <label class="ml-f" style="margin-top:10px">عنوان المرسل (اختياري)<input class="fld" id="aFrom" type="email" dir="ltr" value="${E(a.from && a.from !== a.user ? a.from : '')}"></label>
        </div>
        <div class="ml-hint" id="aRes" hidden></div>
      </div>
      <div class="ml-sh-foot"><button type="button" class="lib-btn" data-a="x">إلغاء</button><button type="button" class="lib-btn" data-a="test">اختبار الاتصال</button><button type="button" class="lib-btn pri" data-a="save">حفظ</button></div>`);
    const q = id => ov.querySelector('#' + id);
    q('aProv').value = a.provider || 'custom'; q('aIs').value = a.imap_sec || 'ssl'; q('aSs').value = a.smtp_sec || 'ssl';
    const fill = key => {
      const P = ML_PROVIDERS[key]; q('aHelp').textContent = P.help;
      if (key !== 'custom'){ q('aIh').value = P.imap[0]; q('aIp').value = P.imap[1]; q('aIs').value = P.imap[2]; q('aSh').value = P.smtp[0]; q('aSp').value = P.smtp[1]; q('aSs').value = P.smtp[2]; }
    };
    q('aHelp').textContent = ML_PROVIDERS[q('aProv').value].help;
    if (!existing) fill(q('aProv').value);
    q('aProv').addEventListener('change', () => fill(q('aProv').value));
    q('aUser').addEventListener('blur', () => { if (!existing && q('aProv').value === 'gmail' || !existing && q('aProv').value === 'custom'){ const g = mlGuessProvider(q('aUser').value); if (g !== q('aProv').value && g !== 'custom'){ q('aProv').value = g; fill(g); } } });
    const read = () => ({
      id:a.id, enabled:a.enabled !== false, is_default:a.is_default, provider:q('aProv').value, user:q('aUser').value.trim(), pass:q('aPass').value,
      name:q('aName').value.trim() || q('aUser').value.trim(), display:q('aDisp').value.trim(),
      imap_host:q('aIh').value.trim(), imap_port:+q('aIp').value || 993, imap_sec:q('aIs').value,
      smtp_host:q('aSh').value.trim(), smtp_port:+q('aSp').value || 465, smtp_sec:q('aSs').value, from:q('aFrom').value.trim() || q('aUser').value.trim(),
    });
    const valid = d => { if (!d.user || d.user.indexOf('@') < 1){ toast('أدخل عنوان بريد صحيحًا'); return false; } if (!d.pass){ toast('أدخل كلمة المرور'); return false; } if (!d.imap_host){ toast('أدخل خادم IMAP'); return false; } return true; };
    const res = (t, ok) => { const r = q('aRes'); r.hidden = !t; r.textContent = t; r.style.color = ok ? 'var(--ok)' : 'var(--danger)'; };
    ov.addEventListener('click', async e => {
      if (e.target === ov) return close();
      const b = e.target.closest('[data-a]'); if (!b) return; const k = b.dataset.a;
      if (k === 'x') return close();
      const d = read();
      if (k === 'test'){
        if (!valid(d)) return;
        b.disabled = true; b.textContent = 'جارٍ الاختبار…'; res('');
        try{
          const j = await mlApi('test', d, {});
          res(j.imap && j.smtp !== false ? `نجح الاتصال (${j.folders} مجلد${j.smtp ? '، والإرسال يعمل' : ''}).` : `القراءة تعمل، لكن الإرسال فشل: ${j.smtp_error || ''}`, j.imap && j.smtp !== false);
        }catch(er){ res(errMsg(er), false); } finally { b.disabled = false; b.textContent = 'اختبار الاتصال'; }
      }
      if (k === 'save'){
        if (!valid(d)) return;
        b.disabled = true; b.textContent = 'جارٍ التحقق…'; res('');
        try{ await mlApi('test', d, { smtp:false }); }
        catch(er){ if (!(await qConfirm(`فشل الاتصال: ${errMsg(er)}\nحفظ الحساب رغم ذلك؟`, { ok:'احفظ', danger:false }))){ b.disabled = false; b.textContent = 'حفظ'; return; } }
        const wasNew = !existing, n = mlUpsert(d); selId = n.id; if (wasNew) mlSetActive(n.id);
        delete mlRt.folders[n.id]; close(); toast('حُفظ الحساب');
        mlPoll(); window.mlAfterAccounts?.(); done?.(n);
      }
    });
  };

  /* ================= إلغاء الاشتراك من النشرات ================= */
  window.mlUnsubClean = async function(acc){
    const { ov, close } = ovOpen('<h3>تنظيف النشرات البريدية</h3><div class="ml-sh-body" id="uBody"><div class="ml-spin">جارٍ فحص آخر 400 رسالة في الوارد…</div></div><div class="ml-sh-foot" id="uFoot"></div>');
    const body = ov.querySelector('#uBody'), foot = ov.querySelector('#uFoot');
    foot.innerHTML = '<button type="button" class="lib-btn" data-a="x">إغلاق</button>';
    ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-a=x]')) close(); });
    let items = [];
    try{ items = (await mlUnsubScan(acc)).items; }catch(e){ body.innerHTML = `<div class="ml-empty">${E(errMsg(e))}</div>`; return; }
    if (!items.length){ body.innerHTML = '<div class="ml-empty"><b>لا نشرات</b>لم أجد رسائل تحمل رابط إلغاء اشتراك في الوارد.</div>'; return; }
    const how = it => it.oneclick ? 'بنقرة واحدة' : it.mailto ? 'برسالة' : 'رابط يدوي';
    body.innerHTML = `<p class="ml-sc" style="padding:10px;font-size:12.5px">حدّد المرسلين الذين تريد إلغاء الاشتراك منهم. «رابط يدوي» يُفتح في المتصفح لتؤكد بنفسك.</p>` + items.map((it, i) => `<label class="ml-un"><input type="checkbox" class="sw sm" data-i="${i}"><div><b>${E(it.name || it.sender)}</b><small dir="ltr">${E(it.sender)}</small><br><small>${it.count} رسالة · ${how(it)} — ${E(it.subject)}</small></div></label>`).join('') +
      `<label class="ml-row" style="padding:6px 4px"><div><b>حذف رسائلهم السابقة</b><small>تُنقل إلى المحذوفات بعد إلغاء الاشتراك بنجاح.</small></div>${sw('uDel', false)}</label>`;
    foot.innerHTML = '<button type="button" class="lib-btn" data-a="x">إغلاق</button><button type="button" class="lib-btn pri" data-a="go">إلغاء الاشتراك من المحدد</button>';
    foot.querySelector('[data-a=go]').addEventListener('click', async e => {
      const picked = [...body.querySelectorAll('[data-i]:checked')].map(c => items[+c.dataset.i]);
      if (!picked.length){ toast('حدّد مرسلًا واحدًا على الأقل'); return; }
      const btn = e.currentTarget; btn.disabled = true;
      const out = await mlUnsubRun(acc, picked, { del:body.querySelector('#uDel').checked }, (n, t) => { btn.textContent = `${n} / ${t}…`; });
      body.innerHTML = out.map(r => `<div class="ml-un"><div><b>${E(r.sender)}</b><small class="${r.state === 'ok' ? 'ml-res-ok' : r.state === 'fail' ? 'ml-res-fail' : ''}">${r.state === 'ok' ? 'تم إلغاء الاشتراك' + (r.deleted ? ` وحُذفت ${r.deleted} رسالة` : '') : r.state === 'open' ? `يتطلب تأكيدًا يدويًا — <a href="${E(r.url)}" target="_blank" rel="noopener noreferrer">افتح الرابط</a>` : E(r.msg || 'فشل')}</small></div></div>`).join('');
      foot.innerHTML = '<button type="button" class="lib-btn pri" data-a="x">تم</button>'; window.__mlRefresh?.();
    });
  };
  window.mlUnsubDialog = async function(acc, msg){
    const u = msg.unsub || {};
    if (!(await qConfirm(`إلغاء الاشتراك من ${(msg.from && (msg.from.addr || msg.from.name)) || 'هذا المرسل'}؟`, { ok:'إلغاء الاشتراك', danger:false }))) return;
    try{
      const r = await mlApi('unsub_exec', acc, { http:u.http, mailto:u.mailto, oneclick:u.oneclick });
      if (r.method === 'open') window.open(r.url, '_blank', 'noopener'); else toast('تم إلغاء الاشتراك');
    }catch(e){ toast(errMsg(e)); }
  };

  /* ================= صفحة الإعدادات ================= */
  window.__mlSub = () => { const n = mlAccounts().length; return n ? `${n} ${n === 1 ? 'حساب' : 'حسابات'}` : 'أضف حسابك'; };

  function render(){
    if (!host) return;
    const accs = mlAccounts(), a = cur();
    let h = '';
    /* ---- الحسابات ---- */
    h += `<div class="ml-sc"><h4><svg class="i"><use href="#i-mail"/></svg>الحسابات</h4>` +
      (accs.length ? accs.map(x => `<div class="ml-acc"><div><b>${E(x.name)}${x.is_default ? ' · الافتراضي' : ''}</b><small dir="ltr">${E(x.user)}</small></div><button type="button" class="lib-btn" data-a="edit" data-id="${E(x.id)}">تعديل</button><button type="button" class="lib-btn dng" data-a="rm" data-id="${E(x.id)}">حذف</button></div>`).join('') : '<p>لم تضف أي حساب بعد.</p>') +
      `<button type="button" class="lib-btn pri" data-a="add">إضافة حساب</button></div>`;
    if (!a){ host.innerHTML = h; return; }
    const p = mlPref(a.id), ar = p.ar;
    const active = mlWindowActive(ar);
    h += `<div class="ml-sc"><div class="ml-row"><div><b>الحساب</b><small>الإعدادات التالية تخص هذا الحساب.</small></div>
      <select class="fld" id="sAcc">${accs.map(x => `<option value="${E(x.id)}"${x.id === a.id ? ' selected' : ''}>${E(x.name)}</option>`).join('')}</select></div>
      <div class="ml-row"><div><b>حساب افتراضي</b><small>يُفتح تلقائيًا عند دخول البريد.</small></div>${sw('sDef', a.is_default)}</div>
      <div class="ml-row"><div><b>تفعيل الحساب</b><small>الحساب المعطّل لا يُجلب بريده ولا يردّ تلقائيًا.</small></div>${sw('sEn', a.enabled)}</div></div>`;

    /* ---- الرد التلقائي ---- */
    h += `<div class="ml-sc"><h4><svg class="i"><use href="#i-reply"/></svg>الرد التلقائي <span class="ml-status${active ? ' on' : ''}" id="arSt">${ar.enabled ? (active ? 'فعّال الآن' : 'مجدول') : 'متوقف'}</span></h4>
      <p>يردّ على الرسائل الواردة أثناء غيابك. يعمل في الخادم حتى لو كان التطبيق مغلقًا، ولا يردّ على النشرات والرسائل الآلية ولا على رسائل وصلت قبل التفعيل.</p>
      <div class="ml-row"><div><b>تفعيل الرد التلقائي</b></div>${sw('arOn', ar.enabled)}</div>
      <div id="arBox" ${ar.enabled ? '' : 'hidden'}>
        <div class="ml-grid"><label class="ml-f">من تاريخ<input type="date" class="fld" id="arStart" value="${E(ar.start)}"></label><label class="ml-f">إلى تاريخ<input type="date" class="fld" id="arEnd" value="${E(ar.end)}"></label></div>
        <label class="ml-f" style="margin-top:10px">عنوان الرد<input class="fld" id="arSub" value="${E(ar.subject)}"><small>استخدم {subject} لإدراج عنوان الرسالة الأصلية.</small></label>
        <label class="ml-f" style="margin-top:10px">نص الرد<textarea class="fld" id="arMsg">${E(ar.message)}</textarea></label>
        <label class="ml-f" style="margin-top:10px">عدم تكرار الرد على نفس المرسل<select class="fld" id="arCd"><option value="period">مرة واحدة طوال الفترة</option><option value="1d">مرة كل يوم</option><option value="3d">مرة كل 3 أيام</option><option value="7d">مرة كل أسبوع</option></select></label>
        <div class="ml-row" style="margin-top:10px"><div><b>تجاهل الرسائل الآلية</b><small>النشرات والإشعارات ورسائل noreply.</small></div>${sw('arEx', ar.excl !== false)}</div>
        <div class="ml-row" style="margin-top:10px"><div><b>إيقاف إشعارات البريد أثناء الرد</b><small>لا تنبيهات ولا عدّاد غير مقروء مادام الرد فعّالًا.</small></div>${sw('arPause', ar.pause)}</div>
        <div class="ml-hint" id="arHint" style="margin-top:10px" hidden></div>
      </div></div>`;

    /* ---- تنظيف النشرات ---- */
    h += `<div class="ml-sc"><h4><svg class="i"><use href="#i-unsub"/></svg>تنظيف النشرات</h4><p>يفحص الوارد ويعرض المرسلين الذين يتيحون إلغاء الاشتراك لتختار منهم.</p><button type="button" class="lib-btn" data-a="clean">فحص وتنظيف</button></div>`;

    /* ---- الوسوم ---- */
    h += `<div class="ml-sc"><h4><svg class="i"><use href="#i-tag"/></svg>وسوم البريد</h4>
      <div class="ml-row"><div><b>إظهار الوسوم</b><small>يصنّف الذكاء الاصطناعي رسائلك (عمل، فواتير، عاجل…) ويعرضها على البطاقات.</small></div>${sw('tgOn', p.tags.on)}</div>
      <div id="tgBox" ${p.tags.on ? '' : 'hidden'}><small style="color:var(--muted)">الوسوم الظاهرة:</small><div class="ml-tg" style="margin-top:8px">${Object.keys(ML_TAGS).map(k => `<button type="button" data-tg="${k}" class="${p.tags.show[k] ? 'on' : ''}" style="--c:${ML_TAGS[k].c}"><i></i>${ML_TAGS[k].l}</button>`).join('')}</div>
      <button type="button" class="lib-btn" data-a="tgclear" style="margin-top:10px">إعادة التصنيف</button></div></div>`;

    /* ---- الصور ---- */
    h += `<div class="ml-sc"><h4><svg class="i"><use href="#i-search"/></svg>الصور</h4>
      <div class="ml-row"><div><b>إخفاء الصور المضمّنة</b><small>تُخفى الصور المرفقة داخل نص الرسالة حتى تضغط «تحميل الصور». الصور البعيدة (الموجودة على الإنترنت) محجوبة دائمًا لحمايتك من التتبّع.</small></div>${sw('imgHide', !p.inline)}</div></div>`;

    /* ---- أسلوب الكتابة ---- */
    h += `<div class="ml-sc"><h4><svg class="i"><use href="#i-sparkles"/></svg>أسلوب كتابة الردود</h4>
      <p>يحلّل الذكاء الاصطناعي رسائلك المرسلة السابقة ويستخلص أسلوبك ليكتب الردود مثلك. تُرسل مقتطفات منها إلى النموذج الذي اخترته.</p>
      <textarea class="fld" id="stTa" placeholder="مثال: نبرة ودّية مختصرة، أبدأ بـ«مرحبًا» وأختم بـ«مع التحية»…" style="min-height:120px">${E(p.style)}</textarea>
      <div class="ml-cmp-tools"><button type="button" class="lib-btn" data-a="stx">استخراج من رسائلي</button><button type="button" class="lib-btn pri" data-a="sts">حفظ</button></div>
      <label class="ml-f" style="margin-top:6px">التوقيع<textarea class="fld" id="sigTa" placeholder="يُضاف إلى الرسائل الجديدة" style="min-height:70px">${E(p.sig)}</textarea></label>
      <button type="button" class="lib-btn" data-a="sigs">حفظ التوقيع</button></div>`;
    host.innerHTML = h;
    if (a){ host.querySelector('#arCd') && (host.querySelector('#arCd').value = ar.cooldown); }
  }

  const arHint = () => {
    const a = cur(), h = host.querySelector('#arHint'); if (!a || !h) return;
    const ar = mlPref(a.id).ar; const warns = [];
    if (ar.enabled && mlIsDay(ar.start) && mlIsDay(ar.end) && ar.end < ar.start) warns.push('تاريخ النهاية قبل البداية.');
    if (ar.enabled && !String(ar.message).trim()) warns.push('نص الرد فارغ.');
    h.hidden = !warns.length; h.textContent = warns.join(' ');
    const st = host.querySelector('#arSt'); if (st){ const on = mlWindowActive(ar); st.textContent = ar.enabled ? (on ? 'فعّال الآن' : 'مجدول') : 'متوقف'; st.classList.toggle('on', on); }
    const d = $('mlArDot'); if (d) d.hidden = !mlWindowActive(mlPref((mlActive() || {}).id || '').ar);
  };

  window.mlRenderSettings = function(el){ host = el; if (!selId || !mlAcct(selId)) selId = (mlActive() || {}).id || ''; render(); arHint(); };

  /* ---- أحداث ---- */
  document.addEventListener('change', async e => {
    if (!host || !host.contains(e.target)) return;
    const a = cur(), t = e.target, id = t.id; if (!a && id !== '') return;
    if (id === 'sAcc'){ selId = t.value; mlSetActive(selId); render(); arHint(); window.mlAfterAccounts?.(); return; }
    if (id === 'sDef'){ if (t.checked) mlSetDefault(a.id); else t.checked = true; render(); return; }
    if (id === 'sEn'){ a.enabled = t.checked; mlSave(); window.mlAfterAccounts?.(); mlPoll(); return; }
    const p = mlPref(a.id), ar = p.ar;
    if (id === 'arOn'){
      ar.enabled = t.checked;
      if (t.checked){ try{ await mlArArm(a); }catch(er){ ar.enabled = false; mlSave(); toast('تعذّر تفعيل الرد التلقائي: ' + errMsg(er)); render(); return; } toast('فُعّل الرد التلقائي — يُرد على الرسائل الجديدة فقط'); }
      mlSave(); render(); arHint(); return;
    }
    const map = { arStart:['start', v => v], arEnd:['end', v => v], arCd:['cooldown', v => v], arEx:['excl', () => t.checked], arPause:['pause', () => t.checked] };
    if (map[id]){ ar[map[id][0]] = map[id][1](t.value); if (id === 'arStart' || id === 'arEnd') ar.at = Date.now(); mlSave(); arHint(); mlPaintBadge(); if (id === 'arCd') toast('حُفظ'); return; }
    if (id === 'tgOn'){ p.tags.on = t.checked; mlSave(); render(); window.__mlRefresh?.(); return; }
    if (id === 'imgHide'){ p.inline = !t.checked; mlSave(); return; }
  });
  document.addEventListener('input', e => {
    if (!host || !host.contains(e.target)) return; const a = cur(); if (!a) return;
    const ar = mlPref(a.id).ar;
    if (e.target.id === 'arSub'){ ar.subject = e.target.value; mlSave(); }
    if (e.target.id === 'arMsg'){ ar.message = e.target.value; mlSave(); arHint(); }
  });
  document.addEventListener('click', async e => {
    if (!host || !host.contains(e.target)) return;
    const tg = e.target.closest('[data-tg]');
    if (tg){ const a = cur(); const p = mlPref(a.id); p.tags.show[tg.dataset.tg] = !p.tags.show[tg.dataset.tg]; mlSave(); tg.classList.toggle('on', p.tags.show[tg.dataset.tg]); window.__mlRefresh?.(); return; }
    const b = e.target.closest('[data-a]'); if (!b) return; const k = b.dataset.a, a = cur();
    if (k === 'add') return window.mlAccountDialog(null, () => { render(); arHint(); });
    if (k === 'edit') return window.mlAccountDialog(mlAcct(b.dataset.id), () => { render(); arHint(); });
    if (k === 'rm'){
      const x = mlAcct(b.dataset.id);
      if (x && await qConfirm(`حذف حساب «${x.name}» من هذا الجهاز؟ لن يُحذف بريدك من الخادم.`, { ok:'حذف' })){ mlRemove(x.id); selId = ''; render(); arHint(); window.mlAfterAccounts?.(); mlPaintBadge(); toast('حُذف الحساب'); }
      return;
    }
    if (!a) return;
    if (k === 'clean') return window.mlUnsubClean(a);
    if (k === 'tgclear'){ delete mlTagDB[a.id]; store.set('ai_mail_tags', mlTagDB); toast('ستُعاد تصنيف الرسائل عند فتح الوارد'); window.__mlRefresh?.(); return; }
    if (k === 'sts'){ mlPref(a.id).style = host.querySelector('#stTa').value.trim().slice(0, 3000); mlSave(); toast('حُفظ أسلوب الكتابة'); return; }
    if (k === 'sigs'){ mlPref(a.id).sig = host.querySelector('#sigTa').value.trim().slice(0, 1000); mlSave(); toast('حُفظ التوقيع'); return; }
    if (k === 'stx'){
      b.disabled = true; const old = b.textContent; b.textContent = 'جارٍ التحليل…';
      try{
        const r = await mlApi('sent_samples', a, { n:12 });
        if (r.samples.length < 3) throw new Error('لا توجد رسائل مرسلة كافية لاستخراج أسلوبك (يلزم 3 على الأقل).');
        host.querySelector('#stTa').value = await mlExtractStyle(r.samples);
        toast('استُخرج الأسلوب — راجعه ثم اضغط حفظ');
      }catch(er){ toast(errMsg(er)); } finally { b.disabled = false; b.textContent = old; }
    }
  });
})();
