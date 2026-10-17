/* QUARK AI — طبقة التطبيق الأصلي (Capacitor): أشرطة النظام، زر الرجوع، الاهتزاز، المشاركة، التخزين الدائم.
   في المتصفح العادي لا يفعل شيئًا (ما عدا saveFile التي تعود للتنزيل المعتاد). */
'use strict';
(() => {
  const Cap = window.Capacitor;
  const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const P = isNative ? (Cap.Plugins || {}) : {};
  window.__native = isNative;
  const call = fn => { try{ const r = fn(); if (r && r.catch) r.catch(() => {}); }catch{} };

  /* ================= حفظ/مشاركة الملفات ================= */
  const blobToBase64 = blob => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
  window.saveFile = async function saveFile(blob, name){
    if (isNative && P.Filesystem && P.Share){
      try{
        const data = await blobToBase64(blob);
        const r = await P.Filesystem.writeFile({ path:name, data, directory:'CACHE' });
        await P.Share.share({ title:name, dialogTitle:'حفظ أو مشاركة الملف', files:[r.uri] });
        return true;
      }catch(e){
        if (/cancel/i.test(String((e && e.message) || e))) return false;
        console.error('saveFile', e); toast('تعذّر حفظ الملف'); return false;
      }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return true;
  };
  window.nativeCopy = async function nativeCopy(t){
    if (isNative && P.Clipboard){ try{ await P.Clipboard.write({ string:t }); return true; }catch{} }
    return false;
  };

  if (!isNative) return;

  /* ================= أشرطة النظام (الحالة + التنقل) ================= */
  const lum = c => {
    let h = String(c || '').trim();
    if (/^#[0-9a-f]{3}$/i.test(h)) h = '#' + h.slice(1).split('').map(x => x + x).join('');
    const m = /^#([0-9a-f]{6})/i.exec(h); if (!m) return null;
    const n = parseInt(m[1], 16);
    return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  };
  function syncBars(){
    const meta = document.querySelector('meta[name=theme-color]'), c = meta && meta.content, l = lum(c);
    if (l === null) return;
    const light = l > 0.6;
    if (P.StatusBar){
      call(() => P.StatusBar.setOverlaysWebView({ overlay:false }));
      call(() => P.StatusBar.setBackgroundColor({ color:c.length === 4 ? '#' + c.slice(1).split('').map(x => x + x).join('') : c.slice(0, 7) }));
      call(() => P.StatusBar.setStyle({ style: light ? 'LIGHT' : 'DARK' }));
    }
    call(() => window.QuarkNative && window.QuarkNative.setNavColor(c.slice(0, 7), !light));
  }
  const themeMeta = document.querySelector('meta[name=theme-color]');
  if (themeMeta) new MutationObserver(syncBars).observe(themeMeta, { attributes:true, attributeFilter:['content'] });
  syncBars(); setTimeout(syncBars, 800); setTimeout(syncBars, 2500);

  /* ================= زر الرجوع ================= */
  const OVERLAYS = '.sheet-ov.show,.lib-ov.show,.img-ov.show,.cam-ov.show,.lib-pop.show,.pv-ov';
  let exitAt = 0;
  function tryExit(){
    const n = Date.now();
    if (n - exitAt < 2000){ call(() => P.App.exitApp()); return; }
    exitAt = n; toast('اضغط مرة أخرى للخروج');
  }
  function closeOverlays(){
    const plan = document.getElementById('planOv'), planOpen = plan && !plan.hidden;
    if (!document.querySelector(OVERLAYS) && !planOpen) return false;
    document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
    document.querySelectorAll('.sheet-ov.show,.lib-ov.show,.img-ov.show,.cam-ov.show,.lib-pop.show').forEach(n => n.classList.remove('show'));
    document.querySelectorAll('.pv-ov').forEach(n => n.remove());
    if (plan && !plan.hidden) plan.hidden = true;
    return true;
  }
  if (P.App) P.App.addListener('backButton', ({ canGoBack }) => {
    const gate = document.getElementById('gate');
    if (gate && !gate.hidden){ tryExit(); return; }
    if (el.sidebar.classList.contains('open')){ closeDrawer(); return; }
    if (closeOverlays()) return;
    if (viewOf() !== 'chat'){ if (canGoBack) history.back(); else showChatView(); return; }
    if (canGoBack){ history.back(); return; }
    tryExit();
  });

  /* ================= اهتزاز خفيف عند اللمس ================= */
  const HSEL = 'button,a[href],[role=button],.row-btn,.lib-tab,.chat-item,.md-chip,.am-row,.am-item,.th-card';
  let lastH = 0;
  document.addEventListener('click', e => {
    if (!P.Haptics || store.get('ai_haptics', true) === false) return;
    const t = e.target.closest && e.target.closest(HSEL);
    if (!t || t.disabled) return;
    const n = Date.now(); if (n - lastH < 80) return; lastH = n;
    call(() => P.Haptics.impact({ style:'LIGHT' }));
  }, true);

  /* ================= تخزين دائم: نسخة مرآة في ملفات التطبيق ================= */
  call(() => navigator.storage && navigator.storage.persist && navigator.storage.persist());
  /* مع تخزين بايثون (داخل ملفات التطبيق الخاصة) لا حاجة لهذه المرآة؛ تبقى فقط كاحتياط عند فشل تشغيل بايثون */
  if (P.Filesystem && !QuarkKV.server){
    const FS = P.Filesystem, STATE = 'quark/state.json';
    let t = 0;
    const flush = async () => {
      clearTimeout(t);
      try{
        const o = {};
        for (let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i); o[k] = localStorage.getItem(k); }
        await FS.writeFile({ path:STATE, data:JSON.stringify(o), directory:'DATA', encoding:'utf8', recursive:true });
      }catch(e){ console.warn('mirror', e); }
    };
    const queue = () => { clearTimeout(t); t = setTimeout(flush, 1500); };
    const sp = Storage.prototype, oSet = sp.setItem, oRm = sp.removeItem, oClr = sp.clear;
    sp.setItem = function(k, v){ oSet.call(this, k, v); if (this === localStorage) queue(); };
    sp.removeItem = function(k){ oRm.call(this, k); if (this === localStorage) queue(); };
    sp.clear = function(){ oClr.call(this); if (this === localStorage) queue(); };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    if (P.App) P.App.addListener('pause', flush);
    queue();

    /* الصور: ملف لكل صورة، وتُستعاد عند الطلب إن فُقدت من IndexedDB */
    const imgPath = id => 'quark/img/' + String(id).replace(/[^\w-]/g, '_') + '.txt';
    const oSave = window.imgSave, oData = window.imgData;
    if (typeof oSave === 'function') window.imgSave = async function(i){
      await oSave(i);
      try{ await FS.writeFile({ path:imgPath(i.id), data:i.data, directory:'DATA', encoding:'utf8', recursive:true }); }catch{}
    };
    if (typeof oData === 'function') window.imgData = async function(id){
      const v = await oData(id); if (v) return v;
      try{
        const r = await FS.readFile({ path:imgPath(id), directory:'DATA', encoding:'utf8' });
        if (r && r.data){ imgCache.set(id, r.data); try{ await imgDB.put(id, r.data); }catch{} return r.data; }
      }catch{}
      return null;
    };
    if (typeof imgDB === 'object' && imgDB.del){
      const oDel = imgDB.del;
      imgDB.del = async k => { const r = await oDel(k); call(() => FS.deleteFile({ path:imgPath(k), directory:'DATA' })); return r; };
    }
    /* نسخ الصور القديمة الموجودة في IndexedDB إلى الملفات مرة واحدة (في الخلفية) */
    setTimeout(async () => {
      try{
        if (store.get('ai_img_mirrored', false)) return;
        for (const k of await imgDB.keys()){
          const v = await imgDB.get(k);
          if (v) await FS.writeFile({ path:imgPath(k), data:v, directory:'DATA', encoding:'utf8', recursive:true });
        }
        store.set('ai_img_mirrored', true);
      }catch{}
    }, 6000);
  }

  /* ================= ودجت الشاشة الرئيسية ================= */
  /* يضغط المستخدم زرًا في الودجت ← MainActivity تحفظ الإجراء ← هنا نُنفّذه بعد جاهزية التطبيق (وبعد فتح القفل إن وُجد) */
  const ready = () => { try{ return document.readyState === 'complete' && $('gate').hidden && pinOv.hidden && typeof newChat === 'function'; }catch{ return false; } };
  const MIME_BY_EXT = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', gif:'image/gif' };
  async function loadShared(files){
    const out = [];
    for (const f of files){
      try{
        const r = await P.Filesystem.readFile({ path:f.path, directory:'CACHE' });
        const bin = atob(r.data), u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const ext = (f.name.split('.').pop() || '').toLowerCase();
        out.push(new File([u8], f.name, { type: f.mime || MIME_BY_EXT[ext] || '' }));
        call(() => P.Filesystem.deleteFile({ path:f.path, directory:'CACHE' }));
      }catch(e){ console.warn('share file', e); }
    }
    return out;
  }
  async function runShare(){
    let o = null; try{ o = JSON.parse(QN2().getPendingShare() || 'null'); }catch{}
    if (!o) return;
    if (!busy) newChat();
    let t = String(o.text || '');
    if (o.subject && !t.includes(o.subject)) t = o.subject + (t ? '\n' + t : '');
    if (t){ el.input.value = t; autosize(); updateSendState(); }
    if (o.files && o.files.length && P.Filesystem){
      const fs = await loadShared(o.files);
      if (fs.length) await addFiles(fs);
    }
    el.input.focus(); call(() => QN2().showKeyboard());
  }
  const QN2 = () => window.QuarkNative;
  function runWidget(a){
    try{
      showChatView();
      if (a === 'settings'){ openSettings('home'); return; }
      if (a === 'stats'){ openSettings('stats'); return; }
      if (a === 'share'){ runShare(); return; }
      if (a === 'chat' || a === 'new'){ if (!busy) newChat(); el.input.focus(); if (a === 'chat') call(() => window.QuarkNative.showKeyboard()); return; }
      if (!busy) newChat();
      if (a === 'camera') openCamera();
      else if (a === 'photo') $('imgInput').click();
      else if (a === 'mic') voiceToggle();
    }catch(e){ console.warn('widget', e); }
  }
  let wTimer = 0;
  window.__widgetPoll = function(){
    let a = ''; try{ a = window.QuarkNative && window.QuarkNative.getPendingAction ? String(window.QuarkNative.getPendingAction()) : ''; }catch{}
    if (!a) return;
    clearInterval(wTimer); let tries = 0;
    wTimer = setInterval(() => {
      if (ready()){ clearInterval(wTimer); setTimeout(() => runWidget(a), 250); }
      else if (++tries > 240) clearInterval(wTimer);   /* ~بعد دقيقة نتوقف (قفل لم يُفتح) */
    }, 250);
  };
  window.__widgetPoll();
  window.addQuarkTile = function(){
    let ok = false; try{ ok = !!(window.QuarkNative && window.QuarkNative.addTile && window.QuarkNative.addTile()); }catch{}
    toast(ok ? 'أكّد إضافة الزر من النافذة التي ظهرت' : 'اسحب الإشعارات للأسفل ← أيقونة القلم ← اسحب «QUARK AI» إلى الأعلى');
  };
  /* زر «إضافة الودجت» في الإعدادات (يظهر داخل التطبيق فقط) */
  { const r = document.getElementById('widgetRow'); if (r) r.style.display = ''; }
  window.pinQuarkWidget = function(){
    let ok = false; try{ ok = !!(window.QuarkNative && window.QuarkNative.pinWidget && window.QuarkNative.pinWidget()); }catch{}
    toast(ok ? 'أكّد إضافة الودجت من النافذة التي ظهرت' : 'أضِفه يدويًا: اضغط مطولًا على الشاشة الرئيسية ← الأدوات ← QUARK AI');
  };

  /* ================= العمل في الخلفية + إشعار اكتمال الرد ================= */
  /* أثناء توليد الرد تعمل خدمة أمامية (إشعار «جارٍ كتابة الرد») فيبقى الرد يُكتب بعد الخروج من التطبيق،
     وعند اكتماله يُرسَل إشعار إن كان التطبيق خارج الشاشة (الشرط يُفحص في الجافا). */
  const QN = () => window.QuarkNative;
  const notifOn = () => store.get('ai_notify', true) !== false;
  const plain = t => String(t || '').replace(/```[\s\S]*?```/g, ' [كود] ').replace(/[#*`>_~|]/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
  /* سياق «الرد السريع» من الإشعار: النقطة والنموذج وآخر الرسائل (نص فقط) — يُحفظ في تخزين التطبيق الأصلي */
  function replyCtx(c){
    try{
      const am = activeModel(); if (!am) return '';
      const h = buildHistory(c).map(m => ({ role:m.role, content:String(m.content || '').slice(0, 6000) })).filter(m => m.content.trim()).slice(-12);
      while (h.length && h[0].role !== 'user') h.shift();
      if (!h.length) return '';
      return JSON.stringify({ proto:am.ep.proto || 'openai', url:am.ep.url, key:am.ep.key || '', model:am.model, system:(typeof sysPrompt === 'function' && sysPrompt()) || '',
        params:resolveParams(c, am), chatId:c.id, title:String(c.title || '').slice(0, 60), messages:h });
    }catch{ return ''; }
  }
  function notifyLast(){
    try{
      let best = null, bt = -1;
      chats.forEach(c => { const m = c.messages[c.messages.length - 1]; if (m && m.role === 'assistant' && (m.ts || 0) >= bt){ best = { c, m }; bt = m.ts || 0; } });
      if (!best) return;
      const { c, m } = best;
      const body = m.error ? 'تعذّر إكمال الرد' : (plain(m.content).slice(0, 180) || (m.gen && m.gen.length ? 'تم توليد الصورة' : 'اكتمل الرد'));
      const full = m.error ? body : String(m.content || '').slice(0, 20000) || body;
      call(() => QN().notifyDone(String(c.title || 'QUARK AI').slice(0, 60), body, full, m.error || c.temp ? '' : replyCtx(c)));
    }catch{}
  }
  /* ردود أُرسلت من الإشعار والتطبيق غائب ← تُضاف إلى محادثتها */
  function importReplies(){
    let arr = []; try{ arr = JSON.parse(QN().takePendingReplies() || '[]'); }catch{}
    if (!arr.length || busy) return;
    let n = 0;
    arr.forEach(r => {
      const c = chats.find(x => x.id === r.chatId); if (!c || !r.user || !r.assistant) return;
      c.messages.push({ role:'user', content:r.user, ts:r.ts }, { role:'assistant', content:r.assistant, model:shortModel(r.model), ts:r.ts + 1 });
      c.ts = r.ts + 1; n++;
    });
    if (n){ save(); renderAll(); }
  }
  setTimeout(importReplies, 2500);
  if (P.App) P.App.addListener('resume', () => setTimeout(importReplies, 400));
  /* أرقام ودجت الإحصائيات */
  function pushStats(){
    try{
      const kept = chats.filter(c => !c.temp), t0 = new Date(); t0.setHours(0, 0, 0, 0);
      const db = store.get('ai_usage_v1', null), ev = db && Array.isArray(db.ev) ? db.ev.filter(e => e.k === 'chat' && e.ts >= t0.getTime()) : [];
      const rep = ev.filter(e => e.ok).length, tok = ev.reduce((n, e) => n + (e.i || 0) + (e.o || 0) + (e.th || 0), 0);
      call(() => QN().setWidgetStats(kept.length, kept.reduce((n, c) => n + c.messages.length, 0), rep, tok));
    }catch{}
  }
  setTimeout(pushStats, 3000);
  if (P.App) P.App.addListener('pause', pushStats);
  const oSetBusy = window.setBusy;
  if (typeof oSetBusy === 'function') window.setBusy = function(v){
    const was = busy, r = oSetBusy.apply(this, arguments);
    if (v && !was){
      call(() => QN().startGen());
      if (notifOn() && !store.get('ai_notif_asked', false)){ store.set('ai_notif_asked', true); call(() => QN().requestNotifPermission()); }
    } else if (!v && was){
      call(() => { if (!(window.__odActive && window.__odActive())) QN().stopGen(); });
      if (notifOn()) setTimeout(notifyLast, 120);   /* الرسالة تُضاف بعد finally مباشرة */
      setTimeout(pushStats, 600);
    }
    return r;
  };
  { const row = document.getElementById('notifyRow'), sw = document.getElementById('notifySw');
    if (row && sw){
      row.style.display = ''; sw.checked = notifOn();
      sw.addEventListener('change', e => {
        store.set('ai_notify', e.target.checked);
        if (e.target.checked){ store.set('ai_notif_asked', true); call(() => QN().requestNotifPermission()); }
        
      });
    } }

  /* ================= الودجت يتبع ثيم التطبيق ================= */
  const cssColor = v => {
    try{
      const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:-9999px;color:' + v;
      document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove();
      const m = c.match(/[\d.]+/g); if (!m || m.length < 3) return null;
      return '#' + m.slice(0, 3).map(x => Math.round(+x).toString(16).padStart(2, '0')).join('');
    }catch{ return null; }
  };
  let lastW = '', wT = 0;
  function syncWidget(){
    clearTimeout(wT);
    const bg = cssColor('var(--surface)'), pill = cssColor('var(--surface-2)'), fg = cssColor('var(--text)'), hint = cssColor('var(--muted)');
    if (!bg || !pill || !fg || !hint) return;
    const key = [bg, pill, fg, hint].join();
    if (key === lastW) return; lastW = key;
    call(() => QN().setWidgetTheme(bg, pill, pill, fg, hint));
  }
  const qSync = () => { clearTimeout(wT); wT = setTimeout(syncWidget, 600); };
  new MutationObserver(qSync).observe(document.documentElement, { attributes:true, attributeFilter:['data-theme', 'style', 'class'] });
  setTimeout(syncWidget, 1500);
  if (P.App) P.App.addListener('pause', syncWidget);

  /* ================= المهام في الخلفية (خدمة أمامية تُبقي مجدول بايثون حيًّا) ================= */
  { const row = document.getElementById('taskBgRow'), sw = document.getElementById('taskBgSw'), help = document.getElementById('taskBgHelp'), batt = document.getElementById('taskBgBatt');
    if (row && sw && window.QuarkNative && typeof QuarkNative.setTaskService === 'function'){
      row.style.display = '';
      const paint = () => {
        let on = false, ign = true; try{ on = !!QN().isTaskServiceOn(); ign = !!QN().isIgnoringBattery(); }catch{}
        sw.checked = on; batt.style.display = on && !ign ? '' : 'none';
        help.textContent = on ? (ign ? 'مفعّلة ✓ — المهام تعمل والتطبيق مغلق.' : 'مفعّلة. إن أوقف هاتفك الخدمة بعد فترة فاستثنِ التطبيق من توفير البطارية.') : '';
      };
      paint();
      sw.addEventListener('change', async e => {
        const on = e.target.checked;
        if (on){ try{ QN().requestNotifPermission(); }catch{} }
        let ok = false; try{ ok = !!QN().setTaskService(on); }catch{}
        if (!ok){ toast('تعذّر تغيير الخدمة'); sw.checked = !on; return; }
         paint();
        if (on && !QN().isIgnoringBattery() && await qConfirm('لضمان عدم إيقاف النظام للخدمة، استثنِ QUARK AI من توفير البطارية. فتح الإعداد الآن؟', { ok:'فتح' })) call(() => QN().requestIgnoreBattery());
      });
      batt.addEventListener('click', () => call(() => QN().requestIgnoreBattery()));
      document.addEventListener('visibilitychange', paint);
    } }

  /* ================= الإيماءات والأزرار ================= */
  { const row = document.getElementById('keysRow'); if (row) row.style.display = '';
    const aSel = document.getElementById('assistAct'), vSel = document.getElementById('volAct'), shake = document.getElementById('shakeSw'), vh = document.getElementById('volHelp');
    if (aSel && vSel && shake){
      aSel.value = store.get('ai_assist_act', 'chat'); vSel.value = store.get('ai_vol_act', ''); shake.checked = store.get('ai_shake', false) === true;
      const push = () => call(() => window.QuarkNative.setKeyConfig(aSel.value, vSel.value));
      const help = () => {
        let on = false; try{ on = !!window.QuarkNative.isKeyServiceOn(); }catch{}
        vh.textContent = !vSel.value ? '' : on ? 'الخدمة مفعّلة ✓ — اضغط زر رفع الصوت مرتين بسرعة.' : 'تتطلب تفعيل خدمة «QUARK AI — اختصار زر الصوت» من إعدادات إمكانية الوصول (تستقبل ضغطات الزر فقط ولا تقرأ الشاشة).';
      };
      push(); help();
      aSel.addEventListener('change', () => { store.set('ai_assist_act', aSel.value); push(); toast('تم الحفظ'); });
      vSel.addEventListener('change', async () => {
        store.set('ai_vol_act', vSel.value); push();
        let on = false; try{ on = !!window.QuarkNative.isKeyServiceOn(); }catch{}
        if (vSel.value && !on && await qConfirm('لاستقبال ضغطتي زر الصوت من أي مكان يجب تفعيل خدمة إمكانية الوصول «QUARK AI — اختصار زر الصوت». الخدمة تكتشف ضغط الزر فقط ولا تقرأ الشاشة أو محتوى التطبيقات. فتح الإعدادات الآن؟', { ok:'فتح الإعدادات' }))
          call(() => window.QuarkNative.openAccessibilitySettings());
        help();
      });
      document.addEventListener('visibilitychange', help);
      document.getElementById('assistBtn').addEventListener('click', () => { call(() => window.QuarkNative.openAssistSettings()); toast('اختر QUARK AI كتطبيق المساعد الرقمي'); });
      shake.addEventListener('change', e => { store.set('ai_shake', e.target.checked);  });
      /* الهز: هزّتان قويّتان خلال ثانية، والتطبيق ظاهر وفي شاشة المحادثة */
      let lastS = 0, cnt = 0, lastFire = 0;
      window.addEventListener('devicemotion', e => {
        if (!shake.checked || document.hidden) return;
        const a = e.accelerationIncludingGravity; if (!a) return;
        const g = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
        if (g < 24) return;
        const n = Date.now(); if (n - lastS < 180) return;
        cnt = n - lastS < 1000 ? cnt + 1 : 1; lastS = n;
        if (cnt >= 2 && n - lastFire > 2500){
          cnt = 0; lastFire = n;
          if (viewOf() === 'chat' && !busy){ newChat(); call(() => P.Haptics && P.Haptics.impact({ style:'MEDIUM' })); toast('محادثة جديدة'); }
        }
      });
    } }
})();
