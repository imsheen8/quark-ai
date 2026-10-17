/* QUARK AI — صفحة البريد: قائمة الرسائل، القارئ، كتابة الرسائل */
'use strict';

(function(){
  const E = v => esc(String(v == null ? '' : v));
  const V = $('mlView'), LIST = $('mlList'), READER = $('mlReader'), SETP = $('mlSetPage');
  const SCHED = '__sched';
  const ROLE_AR = { inbox:'الوارد', sent:'المرسلة', drafts:'المسودات', archive:'الأرشيف', all:'كل البريد', junk:'غير المرغوب', trash:'المحذوفات' };
  const S = { folder:'', filter:'all', q:'', since:'', before:'', page:0, rows:[], more:false, total:0, loading:false, sel:new Set(), selMode:false, tagF:'', sub:false, req:0, acc:'' };
  let R = null;                                           // حالة القارئ المفتوح
  const acc = () => mlActive();
  const folderLabel = f => ROLE_AR[f.role] || f.label;
  const isSent = () => { const a = acc(); return a && S.folder === mlRole(a, 'sent'); };
  const sync = t => { $('mlSync').textContent = t || ''; };
  const errMsg = e => (e && e.message) || 'حدث خطأ غير متوقع';

  /* ---------------- تخطيط الرأس ---------------- */
  function setSub(on){
    S.sub = !!on; V.classList.toggle('ml-sub', S.sub);
    ['mlTools', 'mlSearchOpts', 'mlTagBar', 'mlAccts'].forEach(id => { if (on) $(id).dataset.h = $(id).hidden ? '1' : '0'; $(id).hidden = on ? true : ($(id).dataset.h === '1'); });
    LIST.hidden = S.sub; SETP.hidden = !S.sub; $('mlBulk').hidden = true;
    $('mlBack').hidden = !S.sub; $('mlMenu').hidden = S.sub;
    ['mlSelBtn', 'mlRefresh', 'mlComposeTop'].forEach(id => $(id).hidden = S.sub);
    $('mlTitle').textContent = S.sub ? 'إعدادات البريد' : 'البريد';
    if (S.sub) window.mlRenderSettings?.(SETP); else { paintHead(); renderList(); }
  }
  window.mlShowSettings = setSub;

  function paintHead(){
    const on = mlEnabledAccounts();
    const ac = $('mlAccts'); ac.hidden = S.sub || on.length < 2;
    ac.innerHTML = on.map(a => `<button type="button" data-a="${E(a.id)}" class="${a.id === (acc() || {}).id ? 'on' : ''}">${E(a.name)}</button>`).join('');
    const a = acc(); $('mlArDot').hidden = !(a && mlWindowActive(mlPref(a.id).ar));
    const p = a ? mlPref(a.id) : null;
    const bar = $('mlTagBar');
    const present = new Set(); if (a) S.rows.forEach(r => (mlTagGet(a.id, S.folder, r.uid) || []).forEach(t => present.add(t)));
    const keys = Object.keys(ML_TAGS).filter(k => p && p.tags.show[k] && (present.has(k) || S.tagF === k));
    bar.hidden = S.sub || !(p && p.tags.on) || !keys.length;
    bar.innerHTML = '<button type="button" data-t="" class="' + (S.tagF ? '' : 'on') + '">الكل</button>' +
      keys.map(k => `<button type="button" data-t="${k}" class="${S.tagF === k ? 'on' : ''}"><i style="--c:${ML_TAGS[k].c}"></i>${ML_TAGS[k].l}</button>`).join('');
    const un = a ? (mlRt.unread[a.id] || 0) : 0;
    $('mlTitle').textContent = S.sub ? 'إعدادات البريد' : 'البريد' + (un ? ` (${un})` : '');
    $('mlFolderLbl').textContent = S.folder === SCHED ? 'المجدولة' : (() => { const c = a && mlRt.folders[a.id]; const f = c && c.rows.find(x => x.name === S.folder); return f ? folderLabel(f) : 'الوارد'; })();
    $('mlFab').hidden = !a;
  }

  /* ---------------- تحميل القائمة ---------------- */
  async function load(reset){
    const a = acc();
    if (!a){ renderList(); return; }
    if (S.acc !== a.id){ S.acc = a.id; S.folder = ''; S.rows = []; }
    if (reset){ S.page = 0; S.sel.clear(); S.selMode = false; $('mlBulk').hidden = true; }
    const my = ++S.req; S.loading = true;
    if (reset && !S.rows.length) LIST.innerHTML = '<div class="ml-skel"></div>'.repeat(5);
    sync('…');
    try{
      const folders = await mlFolders(a);
      if (!S.folder) S.folder = (folders.find(f => f.role === 'inbox') || folders[0] || { name:'INBOX' }).name;
      if (S.folder === SCHED){ S.rows = []; S.more = false; S.loading = false; sync(''); paintHead(); renderList(); return; }
      const j = await mlApi('list', a, { folder:S.folder, page:S.page, size:30, filter:S.filter, q:S.q, since:S.since, before:S.before });
      if (my !== S.req) return;
      S.rows = reset || S.page === 0 ? j.rows : S.rows.concat(j.rows.filter(r => !S.rows.some(x => x.uid === r.uid)));
      S.more = j.more; S.total = j.total;
      mlLearn(j.rows);
      const inbox = mlInbox(a);
      if (S.folder === inbox && S.filter === 'all' && !S.q){ const un = (mlRt.folders[a.id].rows.find(f => f.name === inbox) || {}).unseen; if (un != null){ mlRt.unread[a.id] = un; mlPaintBadge(); } }
      sync(new Date().toLocaleTimeString('ar', { hour:'numeric', minute:'2-digit' }));
      paintHead(); renderList();
      if (mlPref(a.id).tags.on) mlTagRows(a, S.folder, j.rows).then(ch => { if (ch && my === S.req) { paintHead(); renderList(); } }).catch(() => {});
    }catch(e){
      if (my !== S.req) return;
      sync(''); LIST.innerHTML = `<div class="ml-empty"><b>تعذّر تحميل البريد</b>${E(errMsg(e))}<br><button type="button" class="lib-btn" id="mlRetry">إعادة المحاولة</button>${e.code === 'auth' ? '<br><button type="button" class="lib-btn" id="mlFixAcc">تعديل الحساب</button>' : ''}</div>`;
    } finally { if (my === S.req) S.loading = false; }
  }

  /* ---------------- عرض القائمة ---------------- */
  function rowHTML(r){
    const a = acc(), p = mlPref(a.id);
    const who = isSent() || S.folder === mlRole(a, 'drafts') ? (r.to[0] ? 'إلى: ' + mlDisp(r.to[0]) : '(بلا مستلم)') : mlDisp(r.from);
    const tags = p.tags.on ? (mlTagGet(a.id, S.folder, r.uid) || []).filter(t => p.tags.show[t]).map(t => `<span class="ml-tag" style="--c:${ML_TAGS[t].c}">${ML_TAGS[t].l}</span>`).join('') : '';
    const lead = S.selMode ? `<span class="ml-chk"><input type="checkbox" class="sw sm" ${S.sel.has(r.uid) ? 'checked' : ''} tabindex="-1"></span>` : `<span class="ml-av">${E(mlInitial(r.from))}</span>`;
    return `<div class="ml-card${r.unread ? ' unread' : ''}${S.sel.has(r.uid) ? ' sel' : ''}" role="button" tabindex="0" data-u="${r.uid}">${lead}
      <div class="ml-main"><div class="ml-l1"><b class="ml-from">${E(who)}</b><span class="ml-date">${E(mlFmtDate(r.date))}</span></div>
      <div class="ml-subj">${E(r.subject || '(بلا موضوع)')}</div>
      <div class="ml-meta">${tags}${r.att ? '<svg class="i"><use href="#i-paperclip"/></svg>' : ''}${r.answered ? '<svg class="i"><use href="#i-reply"/></svg>' : ''}</div></div>
      <button type="button" class="ml-star${r.flagged ? ' on' : ''}" data-star="${r.uid}" aria-label="نجمة"><svg class="i"><use href="#i-star"/></svg></button></div>`;
  }
  const visible = () => S.tagF ? S.rows.filter(r => (mlTagGet((acc() || {}).id, S.folder, r.uid) || []).includes(S.tagF)) : S.rows;

  function renderList(){
    const a = acc();
    if (!a){
      LIST.innerHTML = `<div class="ml-empty"><b>لا يوجد حساب بريد</b>أضف حسابك (Gmail أو Outlook أو أي خادم IMAP) لتقرأ رسائلك وتكتب وترد بمساعدة الذكاء الاصطناعي.<br><button type="button" class="lib-btn pri" id="mlAddAcc">إضافة حساب</button></div>`;
      $('mlTools').hidden = true; $('mlFab').hidden = true; return;
    }
    $('mlTools').hidden = S.sub; $('mlFab').hidden = false;
    if (S.folder === SCHED){
      const l = mlSchedList(a.id);
      LIST.innerHTML = l.length ? l.map(x => `<div class="ml-card" data-sid="${x.id}"><span class="ml-av"><svg class="i"><use href="#i-clock"/></svg></span>
        <div class="ml-main"><div class="ml-l1"><b class="ml-from">إلى: ${E((x.payload.to || []).join('، '))}</b><span class="ml-date">${E(new Date(x.at).toLocaleString('ar', { dateStyle:'medium', timeStyle:'short' }))}</span></div>
        <div class="ml-subj">${E(x.payload.subject || '(بلا موضوع)')}</div></div>
        <button type="button" class="ml-star" data-cancel="${x.id}" aria-label="إلغاء الجدولة"><svg class="i"><use href="#i-x"/></svg></button></div>`).join('')
        : '<div class="ml-empty"><b>لا رسائل مجدولة</b>تُرسل الرسائل المجدولة في وقتها حتى لو كان التطبيق مغلقًا (عند تشغيل الخادم أو خدمة الخلفية في أندرويد).</div>';
      return;
    }
    const rows = visible();
    if (!rows.length){
      LIST.innerHTML = S.loading ? '' : `<div class="ml-empty"><b>${S.q || S.filter !== 'all' || S.tagF ? 'لا نتائج' : 'المجلد فارغ'}</b>${S.q ? 'جرّب كلمات أخرى أو غيّر التاريخ.' : ''}</div>`;
      return;
    }
    LIST.innerHTML = rows.map(rowHTML).join('') + (S.more && !S.tagF ? '<button type="button" class="ml-more" id="mlMore">تحميل المزيد</button>' : '');
  }

  /* ---------------- أفعال على الرسائل ---------------- */
  async function act(op, uids, extra = {}){
    const a = acc(); if (!a || !uids.length) return false;
    try{
      if (op === 'delete') await mlApi('delete', a, { folder:S.folder, uids });
      else if (op === 'archive') await mlApi('archive', a, { folder:S.folder, uids });
      else if (op === 'move') await mlApi('move', a, { folder:S.folder, uids, dest:extra.dest });
      else await mlApi('mark', a, { folder:S.folder, uids, op });
      return true;
    }catch(e){ toast(errMsg(e)); return false; }
  }
  const dropRows = uids => { S.rows = S.rows.filter(r => !uids.includes(r.uid)); S.total = Math.max(0, S.total - uids.length); uids.forEach(u => S.sel.delete(u)); };
  const adjustUnread = n => { const a = acc(); if (a && S.folder === mlInbox(a)){ mlRt.unread[a.id] = Math.max(0, (mlRt.unread[a.id] || 0) + n); mlPaintBadge(); } };

  async function toggleStar(uid){
    const r = S.rows.find(x => x.uid === uid); if (!r) return;
    const want = !r.flagged; r.flagged = want; renderList();
    if (!(await act(want ? 'flag' : 'unflag', [uid]))){ r.flagged = !want; renderList(); }
  }

  /* تحديد متعدد */
  function setSel(on){ S.selMode = on; if (!on) S.sel.clear(); $('mlBulk').hidden = !on; $('mlSelBtn').classList.toggle('on', on); bulkN(); renderList(); }
  function bulkN(){ $('mlBulkN').textContent = S.sel.size + ' محدد'; $('mlAll').checked = S.sel.size > 0 && S.sel.size === visible().length; }
  async function bulk(op){
    const uids = [...S.sel]; if (!uids.length){ toast('حدّد رسائل أولًا'); return; }
    if (op === 'delete' && !(await qConfirm(`حذف ${uids.length} رسالة؟`, { ok:'حذف' }))) return;
    const unreadN = S.rows.filter(r => uids.includes(r.uid) && r.unread).length;
    if (!(await act(op, uids))) return;
    if (op === 'read'){ S.rows.forEach(r => { if (uids.includes(r.uid)) r.unread = false; }); adjustUnread(-unreadN); }
    else { dropRows(uids); adjustUnread(-unreadN); }
    toast(op === 'delete' ? 'تم الحذف' : op === 'archive' ? 'تمت الأرشفة' : 'تم التعليم كمقروء');
    S.sel.clear(); bulkN(); renderList();
  }

  /* ---------------- القارئ ---------------- */
  const REMOTE_IMG = /<img[^>]+src\s*=\s*["']?\s*https?:|url\(\s*["']?\s*https?:|background\s*=\s*["']?\s*https?:/i;
  function buildDoc(html, cids, allowRemote, allowInline){
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,iframe,frame,frameset,object,embed,applet,form,input,button,select,textarea,link,meta,base,noscript,template,svg,math,audio,video,source,portal').forEach(n => n.remove());
    doc.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(at => {
        const n = at.name.toLowerCase();
        if (n.startsWith('on') || n === 'srcdoc' || n === 'formaction') el.removeAttribute(at.name);
        else if (['href', 'src', 'background', 'xlink:href', 'action', 'poster', 'data'].includes(n) && /^(javascript|vbscript|data:text\/html)/i.test(at.value.replace(/[\u0000-\u0020]/g, ''))) el.removeAttribute(at.name);
      });
    });
    let hiddenInline = 0;
    doc.querySelectorAll('img').forEach(img => {
      const s = (img.getAttribute('src') || '').trim();
      if (/^cid:/i.test(s)){
        const k = s.slice(4).replace(/^<|>$/g, '');
        if (allowInline && cids && cids[k]) img.setAttribute('src', cids[k]);
        else { img.removeAttribute('src'); if (!img.alt) img.alt = 'صورة مخفية'; hiddenInline++; }
      }
      img.removeAttribute('srcset');
      if (!allowRemote && /^https?:/i.test((img.getAttribute('src') || '').trim())){ img.removeAttribute('src'); img.setAttribute('data-blocked', '1'); }
    });
    doc.querySelectorAll('a[href]').forEach(a => { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer nofollow'); });
    doc.querySelectorAll('blockquote,.gmail_quote,.yahoo_quoted,#divRplyFwdMsg,#appendonsend').forEach(q => {
      if (!q.parentNode || q.closest('details.ml-q')) return;
      const d = doc.createElement('details'); d.className = 'ml-q'; const s = doc.createElement('summary'); s.textContent = '⋯ عرض النص المقتبس';
      d.appendChild(s); q.parentNode.insertBefore(d, q); d.appendChild(q);
    });
    const csp = `default-src 'none'; img-src data: ${allowRemote ? 'https: http:' : ''}; style-src 'unsafe-inline'`;
    const base = 'body{margin:0;padding:12px;background:#fff;color:#111;font:15px/1.7 system-ui,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}img:not([src]){display:none}table{max-width:100%}details.ml-q>summary{cursor:pointer;color:#888;font-size:12px;margin:6px 0}';
    return { hiddenInline, srcdoc:`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>${base}</style>${doc.head.innerHTML}</head><body>${doc.body.innerHTML}</body></html>` };
  }
  const linkify = t => E(t).replace(/(https?:\/\/[^\s<>"')]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer nofollow">$1</a>');

  function drawBody(){
    const { msg, acc: a } = R, host = $('rdBody'); if (!host) return;
    const p = mlPref(a.id);
    const banners = $('rdBanners'); banners.innerHTML = '';
    if (msg.html){
      const remote = REMOTE_IMG.test(msg.html);
      const out = buildDoc(msg.html, msg.cids, R.remote, p.inline || R.remote);
      host.innerHTML = '<iframe class="ml-frame" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" title="نص الرسالة"></iframe>';
      const fr = host.firstChild;
      const fit = () => { try{ const d = fr.contentDocument; fr.style.height = Math.max(120, d.documentElement.scrollHeight + 4) + 'px'; }catch{} };
      fr.addEventListener('load', () => { fit(); try{ fr.contentDocument.addEventListener('toggle', fit, true); new ResizeObserver(fit).observe(fr.contentDocument.documentElement); }catch{} });
      fr.srcdoc = out.srcdoc;
      if ((remote && !R.remote) || out.hiddenInline){
        banners.innerHTML = `<div class="ml-banner"><span>${remote && !R.remote ? 'حُجبت الصور البعيدة لحمايتك من التتبّع.' : 'الصور المضمّنة مخفية (إعداد البريد).'}</span><button type="button" class="lib-btn" id="rdImgs">تحميل الصور</button></div>`;
      }
    } else {
      const sp = mlQuoteSplit(msg.text || '');
      host.innerHTML = `<div class="ml-text">${linkify(sp.main || '(رسالة فارغة)')}</div>` +
        (sp.sig ? `<button type="button" class="ml-fold" data-fold="sig">⋯ التوقيع</button><div class="ml-sig" hidden>${linkify(sp.sig)}</div>` : '') +
        (sp.quoted ? `<button type="button" class="ml-fold" data-fold="q">⋯ عرض النص المقتبس</button><div class="ml-quoted" hidden>${linkify(sp.quoted)}</div>` : '');
    }
  }

  async function openReader(row, folder){
    const a = acc(); if (!a) return;
    const my = ++S.req;
    R = { row, folder:folder || S.folder, acc:a, msg:null, remote:false, ai:'' };
    V.classList.add('ml-rd'); READER.hidden = false;
    READER.innerHTML = `<div class="ml-rd-top"><button type="button" class="lib-ib" data-a="close" aria-label="رجوع"><svg class="i"><use href="#i-lib-back"/></svg></button><h3>${E(row.subject || '(بلا موضوع)')}</h3></div><div class="ml-spin">جارٍ فتح الرسالة…</div>`;
    try{
      const drafts = R.folder === mlRole(a, 'drafts');
      const msg = await mlApi('read', a, { folder:R.folder, uid:row.uid, mark_seen:true, inline:true });
      if (!R || R.row !== row) return;
      R.msg = msg;
      if (row.unread && msg.marked){ row.unread = false; adjustUnread(-1); }
      mlLearn([{ from:msg.from, to:msg.to }]);
      renderReader();
      if (drafts) openCompose({ draft:{ to:msg.to.map(x => x.addr), subject:msg.subject, body:msg.text } });
      renderList();
    }catch(e){
      if (!R || R.row !== row) return;
      READER.querySelector('.ml-spin').innerHTML = `${E(errMsg(e))}<br><button type="button" class="lib-btn" data-a="close">رجوع</button>`;
    }
    void my;
  }
  function closeReader(){ R = null; READER.hidden = true; READER.innerHTML = ''; V.classList.remove('ml-rd'); renderList(); }

  function renderReader(){
    const { row, msg, acc: a } = R;
    const to = (msg.to || []).map(x => x.name ? `${x.name} <${x.addr}>` : x.addr).join('، ');
    const cc = (msg.cc || []).map(x => x.name ? `${x.name} <${x.addr}>` : x.addr).join('، ');
    const un = msg.unsub && (msg.unsub.mailto || msg.unsub.http);
    READER.innerHTML = `
      <div class="ml-rd-top"><button type="button" class="lib-ib" data-a="close" aria-label="رجوع"><svg class="i"><use href="#i-lib-back"/></svg></button><h3>${E(msg.subject || '(بلا موضوع)')}</h3>
        <button type="button" class="lib-ib ml-star${row.flagged ? ' on' : ''}" data-a="star" aria-label="نجمة"><svg class="i"><use href="#i-star"/></svg></button>
        <button type="button" class="lib-ib" data-a="unread" aria-label="تعليم كغير مقروءة" title="غير مقروءة"><svg class="i"><use href="#i-mail"/></svg></button>
        <button type="button" class="lib-ib" data-a="move" aria-label="نقل" title="نقل"><svg class="i"><use href="#i-folder"/></svg></button>
        <button type="button" class="lib-ib" data-a="archive" aria-label="أرشفة" title="أرشفة"><svg class="i"><use href="#i-archive"/></svg></button>
        <button type="button" class="lib-ib" data-a="spam" aria-label="غير مرغوب" title="غير مرغوب"><svg class="i"><use href="#i-alert"/></svg></button>
        <button type="button" class="lib-ib" data-a="del" aria-label="حذف" title="حذف"><svg class="i"><use href="#i-trash"/></svg></button></div>
      <div class="ml-rd-scroll">
        <div class="ml-rd-subj">${E(msg.subject || '(بلا موضوع)')}</div>
        <div class="ml-rd-who"><span class="ml-av">${E(mlInitial(msg.from))}</span><div><b>${E(mlDisp(msg.from))}</b><small><bdi dir="ltr">${E(msg.from.addr)}</bdi> · <bdi>${E(msg.date ? new Date(msg.date).toLocaleString('ar', { dateStyle:'medium', timeStyle:'short' }) : '')}</bdi></small></div>
          <button type="button" class="lib-ib" data-a="det" aria-label="التفاصيل"><svg class="i"><use href="#i-chevron-down"/></svg></button></div>
        <div class="ml-rd-det" id="rdDet" hidden>إلى: ${E(to || '—')}${cc ? '<br>نسخة: ' + E(cc) : ''}${msg.reply_to && msg.reply_to[0] ? '<br>الرد إلى: ' + E(msg.reply_to[0].addr) : ''}</div>
        <div class="ml-rd-bar">
          <button type="button" class="lib-btn" data-a="reply"><svg class="i"><use href="#i-reply"/></svg>رد</button>
          <button type="button" class="lib-btn" data-a="all"><svg class="i"><use href="#i-reply-all"/></svg>رد للجميع</button>
          <button type="button" class="lib-btn" data-a="fwd"><svg class="i"><use href="#i-forward"/></svg>تحويل</button>
          <button type="button" class="lib-btn" data-a="sum"><svg class="i"><use href="#i-sparkles"/></svg>تلخيص</button>
          <button type="button" class="lib-btn" data-a="tr"><svg class="i"><use href="#i-sparkles"/></svg>ترجمة</button>
          <button type="button" class="lib-btn" data-a="ai"><svg class="i"><use href="#i-sparkles"/></svg>رد بالذكاء</button>
        </div>
        <div id="rdAi"></div>
        ${un ? `<div class="ml-banner"><span>هذه رسالة نشرة بريدية.</span><button type="button" class="lib-btn" data-a="unsub"><svg class="i"><use href="#i-unsub"/></svg> إلغاء الاشتراك</button></div>` : ''}
        ${msg.attachments.length ? `<div class="ml-atts">${msg.attachments.map(x => `<button type="button" class="ml-att" data-att="${x.index}" data-name="${E(x.name)}"><svg class="i"><use href="#i-paperclip"/></svg><span>${E(x.name)}</span><small>${E(mlBytes(x.size))}</small></button>`).join('')}</div>` : ''}
        <div id="rdBanners"></div><div id="rdBody"></div>
      </div>`;
    drawBody();
  }

  async function readerAct(a){
    const { row, msg, acc: ac } = R;
    if (a === 'close') return closeReader();
    if (a === 'det') return $('rdDet').toggleAttribute('hidden');
    if (a === 'star'){ row.flagged = !row.flagged; READER.querySelector('[data-a=star]').classList.toggle('on', row.flagged); const ok = await act(row.flagged ? 'flag' : 'unflag', [row.uid]); if (!ok){ row.flagged = !row.flagged; READER.querySelector('[data-a=star]')?.classList.toggle('on', row.flagged); } return; }
    if (a === 'unread'){ if (await act('unread', [row.uid])){ if (!row.unread) adjustUnread(1); row.unread = true; toast('عُلّمت كغير مقروءة'); closeReader(); } return; }
    if (a === 'del'){ if (await act('delete', [row.uid])){ dropRows([row.uid]); toast('تم الحذف'); closeReader(); } return; }
    if (a === 'archive'){ if (await act('archive', [row.uid])){ dropRows([row.uid]); toast('تمت الأرشفة'); closeReader(); } return; }
    if (a === 'spam'){ if (await act('spam', [row.uid])){ dropRows([row.uid]); toast('نُقلت إلى غير المرغوب'); closeReader(); } return; }
    if (a === 'move'){ const dest = await pickFolder('نقل إلى', S.folder, true); if (dest && await act('move', [row.uid], { dest })){ dropRows([row.uid]); toast('تم النقل'); closeReader(); } return; }
    if (a === 'reply' || a === 'all' || a === 'fwd') return openCompose({ msg, mode:a === 'fwd' ? 'forward' : a === 'all' ? 'all' : 'reply', folder:R.folder, uid:row.uid });
    if (a === 'sum' || a === 'tr'){
      const box = $('rdAi'); box.innerHTML = '<div class="ml-ai"><small>الذكاء الاصطناعي</small>جارٍ المعالجة…</div>';
      try{
        const t = a === 'sum' ? await mlSummarize(msg) : await mlTranslate(msg, 'العربية');
        if (R && R.row === row) box.innerHTML = `<div class="ml-ai"><small>${a === 'sum' ? 'ملخص' : 'ترجمة'}</small>${E(t)}</div>`;
      }catch(e){ box.innerHTML = `<div class="ml-ai"><small>تعذّر</small>${E(errMsg(e))}</div>`; }
      return;
    }
    if (a === 'ai') return openCompose({ msg, mode:'reply', folder:R.folder, uid:row.uid, aiNow:true });
    if (a === 'unsub') return window.mlUnsubDialog?.(ac, msg);
  }

  /* ---------------- منتقي المجلدات ---------------- */
  async function pickFolder(title, current, noSched){
    const a = acc(); if (!a) return null;
    let rows = [];
    try{ rows = await mlFolders(a); }catch(e){ toast(errMsg(e)); return null; }
    return new Promise(res => {
      const ov = document.createElement('div'); ov.className = 'ml-ov';
      const sched = noSched ? '' : mlSchedList(a.id).length ? mlSchedList(a.id).length : 0;
      ov.innerHTML = `<div class="ml-sheet"><h3>${E(title)}</h3><div class="ml-sh-body">${rows.map(f => `<button type="button" class="ml-fo${f.name === current ? ' on' : ''}" data-f="${E(f.name)}"><svg class="i"><use href="#i-${f.role === 'inbox' ? 'inbox' : 'folder'}"/></svg>${E(folderLabel(f))}${f.unseen ? `<em>${f.unseen}</em>` : ''}</button>`).join('')}
        ${noSched ? '' : `<button type="button" class="ml-fo${current === SCHED ? ' on' : ''}" data-f="${SCHED}"><svg class="i"><use href="#i-clock"/></svg>المجدولة${sched ? `<em>${sched}</em>` : ''}</button>`}</div></div>`;
      const done = v => { ov.remove(); res(v); };
      ov.addEventListener('click', e => { if (e.target === ov) return done(null); const b = e.target.closest('[data-f]'); if (b) done(b.dataset.f); });
      document.body.appendChild(ov);
    });
  }

  /* ---------------- كتابة رسالة ---------------- */
  const readB64 = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => no(r.error); r.readAsDataURL(f); });
  function openCompose(o = {}){
    const a0 = acc(); if (!a0){ toast('أضف حساب بريد أولًا'); return; }
    const accs = mlEnabledAccounts();
    const parts = o.msg ? mlReplyParts(o.msg, o.mode, mlSelfAddrs()) : null;
    const draft = o.draft || {};
    const pre = parts || { to:(draft.to || []).map(x => ({ addr:x })), cc:[], subject:draft.subject || '', body:draft.body || '', in_reply_to:'', references:'' };
    const files = []; let sending = false;
    const ov = document.createElement('div'); ov.className = 'ml-cmp';
    const sig = mlPref(a0.id).sig;
    const addrs = l => (l || []).map(x => x.addr).join(', ');
    ov.innerHTML = `
      <div class="ml-cmp-top"><button type="button" class="lib-ib" data-c="close" aria-label="إغلاق"><svg class="i"><use href="#i-x"/></svg></button><h3>${o.mode === 'forward' ? 'تحويل' : o.msg ? 'رد' : 'رسالة جديدة'}</h3>
        <button type="button" class="lib-btn" data-c="draft">حفظ مسودة</button><button type="button" class="lib-btn pri" data-c="send"><svg class="i"><use href="#i-send"/></svg> إرسال</button></div>
      <div class="ml-cmp-body">
        ${accs.length > 1 ? `<div class="ml-fr"><label>من</label><select class="fld" id="cFrom">${accs.map(x => `<option value="${E(x.id)}"${x.id === a0.id ? ' selected' : ''}>${E(x.name)} — ${E(x.from)}</option>`).join('')}</select></div>` : ''}
        <div class="ml-fr"><label>إلى</label><input id="cTo" type="text" inputmode="email" dir="ltr" autocomplete="off" value="${E(addrs(pre.to))}"><button type="button" class="lib-btn" data-c="ccbcc" style="height:30px">نسخة</button></div>
        <div class="ml-fr" id="cCcRow" ${pre.cc.length ? '' : 'hidden'}><label>نسخة</label><input id="cCc" type="text" inputmode="email" dir="ltr" autocomplete="off" value="${E(addrs(pre.cc))}"></div>
        <div class="ml-fr" id="cBccRow" hidden><label>مخفية</label><input id="cBcc" type="text" inputmode="email" dir="ltr" autocomplete="off"></div>
        <div class="ml-fr"><label>الموضوع</label><input id="cSub" type="text" dir="auto" value="${E(pre.subject)}"></div>
        <textarea class="ml-ta" id="cBody" placeholder="اكتب رسالتك…">${E(o.msg || draft.body ? pre.body : (sig ? '\n\n-- \n' + sig : ''))}</textarea>
        <div class="ml-aibox" id="cAiBox" hidden><input id="cAiIn" type="text" placeholder="ماذا تريد أن تقول؟ (اختياري)"><button type="button" class="lib-btn pri" data-c="aigo">اكتب</button></div>
        <div class="ml-atts" id="cFiles"></div>
        <div class="ml-sched" id="cSched" hidden><label>أرسل في <input type="datetime-local" class="fld" id="cAt"></label><small class="ml-status">تُرسل في وقتها حتى مع إغلاق التطبيق</small></div>
        <div class="ml-cmp-tools">
          <button type="button" class="lib-btn" data-c="attach"><svg class="i"><use href="#i-paperclip"/></svg>إرفاق</button>
          <button type="button" class="lib-btn" data-c="ai"><svg class="i"><use href="#i-sparkles"/></svg>اكتب بالذكاء</button>
          <button type="button" class="lib-btn" data-c="sched"><svg class="i"><use href="#i-clock"/></svg>جدولة</button>
          <input type="file" id="cFile" multiple hidden></div>
      </div>`;
    document.body.appendChild(ov);
    const q = id => ov.querySelector('#' + id);
    const curAcc = () => mlAcct((q('cFrom') || {}).value) || a0;
    const close = async force => {
      if (!force && (q('cTo').value.trim() || q('cSub').value.trim() || q('cBody').value.trim() !== pre.body.trim() && q('cBody').value.trim()) && !sending)
        if (!(await qConfirm('تجاهل هذه الرسالة؟', { ok:'تجاهل' }))) return;
      ov.remove();
    };
    /* اقتراح جهات الاتصال للحقول الثلاثة */
    ['cTo', 'cCc', 'cBcc'].forEach(id => {
      const inp = q(id); let box = null;
      const hide = () => { box?.remove(); box = null; };
      inp.addEventListener('input', () => {
        hide(); const tok = inp.value.split(/[;,،]/).pop().trim(); const sg = mlSuggest(tok); if (!sg.length) return;
        box = document.createElement('div'); box.className = 'ml-sug';
        box.innerHTML = sg.map(s => `<button type="button" data-a="${E(s.addr)}">${E(s.name || s.addr)}<small dir="ltr">${E(s.addr)}</small></button>`).join('');
        box.addEventListener('mousedown', e => e.preventDefault());
        box.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (!b) return; const parts = inp.value.split(/[;,،]/); parts.pop(); parts.push(' ' + b.dataset.a); inp.value = parts.join(',').replace(/^[\s,]+/, '') + ', '; hide(); inp.focus(); });
        inp.parentNode.appendChild(box);
      });
      inp.addEventListener('blur', () => setTimeout(hide, 150));
    });
    const paintFiles = () => { q('cFiles').innerHTML = files.map((f, i) => `<span class="ml-att"><svg class="i"><use href="#i-paperclip"/></svg><span>${E(f.name)}</span><small>${E(mlBytes(f.size))}</small><button type="button" data-rm="${i}" aria-label="إزالة"><svg class="i"><use href="#i-x"/></svg></button></span>`).join(''); };
    const payload = () => {
      const to = mlSplitAddrs(q('cTo').value), cc = mlSplitAddrs(q('cCc').value), bcc = mlSplitAddrs(q('cBcc').value);
      return { to, cc, bcc, subject:q('cSub').value.trim(), text:q('cBody').value, in_reply_to:pre.in_reply_to, references:pre.references,
        attachments:files.map(f => ({ name:f.name, type:f.type, b64:f.b64 })), reply_uid:o.mode === 'forward' ? 0 : (o.uid || 0), reply_folder:o.folder || '' };
    };
    ov.addEventListener('click', async e => {
      const rm = e.target.closest('[data-rm]'); if (rm){ files.splice(+rm.dataset.rm, 1); paintFiles(); return; }
      const b = e.target.closest('[data-c]'); if (!b) return; const c = b.dataset.c;
      if (c === 'close') return close();
      if (c === 'ccbcc'){ q('cCcRow').hidden = false; q('cBccRow').hidden = false; return; }
      if (c === 'attach') return q('cFile').click();
      if (c === 'sched'){ const s = q('cSched'); s.hidden = !s.hidden; if (!s.hidden && !q('cAt').value){ const d = new Date(Date.now() + 3600000); d.setMinutes(0, 0, 0); q('cAt').value = new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); } return; }
      if (c === 'ai'){ if (o.msg){ q('cAiBox').hidden = !q('cAiBox').hidden; q('cAiIn').focus(); } else { q('cAiBox').hidden = !q('cAiBox').hidden; q('cAiIn').placeholder = 'عمّ تريد أن تكتب الرسالة؟'; q('cAiIn').focus(); } return; }
      if (c === 'aigo') return aiWrite();
      if (c === 'draft'){
        const p = payload(); b.disabled = true;
        try{ await mlApi('draft', curAcc(), p); toast('حُفظت المسودة'); }catch(er){ toast(errMsg(er)); } finally { b.disabled = false; } return;
      }
      if (c === 'send') return doSend(b);
    });
    q('cFile').addEventListener('change', async e => {
      for (const f of e.target.files){
        if (files.reduce((n, x) => n + x.size, 0) + f.size > 20 * 1048576){ toast('مجموع المرفقات يتجاوز 20 ميغابايت'); break; }
        try{ files.push({ name:f.name, type:f.type || 'application/octet-stream', size:f.size, b64:await readB64(f) }); }catch{ toast('تعذّر قراءة الملف'); }
      }
      e.target.value = ''; paintFiles();
    });
    async function aiWrite(){
      const inst = q('cAiIn').value.trim(), btn = ov.querySelector('[data-c=aigo]');
      if (!o.msg && !inst){ toast('اكتب فكرة الرسالة أولًا'); return; }
      btn.disabled = true; btn.textContent = '…';
      try{
        const style = mlPref(curAcc().id).style;
        const text = o.msg ? await mlDraftReply({ msg:o.msg, instruction:inst, style, mode:o.mode })
          : await mlAI(`اكتب نص رسالة بريد إلكتروني بصفتي بناءً على فكرتي التالية. أرجع النص فقط بلا موضوع ولا شرح.${style ? '\nأسلوب كتابتي:\n' + mlCap(style, 1200) : ''}\nالفكرة: ${inst}`, { max:900 });
        const ta = q('cBody'), s = mlPref(curAcc().id).sig;
        ta.value = text + (s ? '\n\n-- \n' + s : '') + (o.msg ? '\n' + pre.body : '');
        ta.focus(); ta.setSelectionRange(0, 0);
      }catch(er){ toast(errMsg(er)); } finally { btn.disabled = false; btn.textContent = 'اكتب'; }
    }
    async function doSend(btn){
      const p = payload(); if (sending) return;
      if (!p.to.length){ toast('أضف مستلمًا واحدًا على الأقل'); return; }
      if (!p.subject && !(await qConfirm('إرسال بدون موضوع؟', { ok:'إرسال', danger:false }))) return;
      const ac = curAcc(); sending = true; btn.disabled = true;
      try{
        if (!q('cSched').hidden){
          const at = new Date(q('cAt').value).getTime();
          if (!at || at < Date.now() + 30000){ toast('اختر وقتًا في المستقبل'); return; }
          mlSchedAdd(ac.id, p, at); toast('جُدولت الرسالة'); ov.remove(); window.__mlSchedChanged?.(); return;
        }
        await mlApi('send', ac, p);
        toast('أُرسلت الرسالة'); ov.remove();
        if (o.uid && o.mode !== 'forward'){ const r = S.rows.find(x => x.uid === o.uid); if (r) r.answered = true; }
        if (R) closeReader();
        if (isSent()) load(true);
      }catch(er){ toast(errMsg(er)); } finally { sending = false; btn.disabled = false; }
    }
    if (o.aiNow){ q('cAiBox').hidden = false; q('cAiIn').focus(); }
    else if (!pre.to.length) q('cTo').focus(); else q('cBody').focus();
  }
  window.mlCompose = openCompose;

  /* ---------------- ربط الأحداث ---------------- */
  LIST.addEventListener('click', e => {
    if (e.target.closest('#mlRetry')) return load(true);
    if (e.target.closest('#mlFixAcc')){ setSub(true); return; }
    if (e.target.closest('#mlAddAcc')){ window.mlAccountDialog?.(null, () => { paintHead(); load(true); }); return; }
    if (e.target.closest('#mlMore')){ S.page++; load(false); return; }
    const cx = e.target.closest('[data-cancel]'); if (cx){ mlSchedCancel(cx.dataset.cancel); renderList(); toast('أُلغيت الجدولة'); return; }
    const st = e.target.closest('[data-star]'); if (st){ e.stopPropagation(); toggleStar(+st.dataset.star); return; }
    const card = e.target.closest('.ml-card[data-u]'); if (!card) return;
    const row = S.rows.find(r => r.uid === +card.dataset.u); if (!row) return;
    if (S.selMode){ S.sel.has(row.uid) ? S.sel.delete(row.uid) : S.sel.add(row.uid); bulkN(); renderList(); return; }
    openReader(row);
  });
  LIST.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('ml-card')){ e.preventDefault(); e.target.click(); } });
  READER.addEventListener('click', async e => {
    const att = e.target.closest('[data-att]');
    if (att && R){
      att.disabled = true;
      try{ const j = await mlApi('attachment', R.acc, { folder:R.folder, uid:R.row.uid, index:+att.dataset.att }); const bin = atob(j.b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); saveFile(new Blob([u], { type:j.type }), j.name); }
      catch(er){ toast(errMsg(er)); } finally { att.disabled = false; }
      return;
    }
    const fold = e.target.closest('[data-fold]');
    if (fold){ const t = fold.nextElementSibling; t.hidden = !t.hidden; return; }
    if (e.target.closest('#rdImgs') && R){ R.remote = true; drawBody(); return; }
    const b = e.target.closest('[data-a]'); if (b && R) readerAct(b.dataset.a);
  });
  $('mlAccts').addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (!b) return; mlSetActive(b.dataset.a); S.folder = ''; S.tagF = ''; S.rows = []; paintHead(); load(true); });
  $('mlTagBar').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (!b) return; S.tagF = b.dataset.t; paintHead(); renderList(); });
  $('mlFilter').addEventListener('change', e => { S.filter = e.target.value; load(true); });
  $('mlFolderBtn').addEventListener('click', async () => { const f = await pickFolder('المجلدات', S.folder); if (f && f !== S.folder){ S.folder = f; S.tagF = ''; S.rows = []; load(true); } });
  let tm = null;
  $('mlSearch').addEventListener('input', e => { clearTimeout(tm); tm = setTimeout(() => { S.q = e.target.value.trim(); load(true); }, 450); });
  $('mlSearch').addEventListener('keydown', e => { if (e.key === 'Enter'){ clearTimeout(tm); S.q = e.target.value.trim(); load(true); } });
  $('mlSearchOpt').addEventListener('click', () => { $('mlSearchOpts').hidden = !$('mlSearchOpts').hidden; });
  const dates = () => { S.since = $('mlDateFrom').value; S.before = $('mlDateTo').value; load(true); };
  $('mlDateFrom').addEventListener('change', dates); $('mlDateTo').addEventListener('change', dates);
  $('mlOptClear').addEventListener('click', () => { $('mlDateFrom').value = $('mlDateTo').value = ''; dates(); });
  $('mlRefresh').addEventListener('click', async () => { if (S.sub) return; try{ await mlFolders(acc(), true); }catch{} load(true); });
  $('mlSelBtn').addEventListener('click', () => setSel(!S.selMode));
  $('mlBulkX').addEventListener('click', () => setSel(false));
  $('mlAll').addEventListener('change', e => { visible().forEach(r => e.target.checked ? S.sel.add(r.uid) : S.sel.delete(r.uid)); bulkN(); renderList(); });
  $('mlBulkRead').addEventListener('click', () => bulk('read'));
  $('mlBulkArch').addEventListener('click', () => bulk('archive'));
  $('mlBulkDel').addEventListener('click', () => bulk('delete'));
  $('mlSetBtn').addEventListener('click', () => setSub(!S.sub));
  $('mlBack').addEventListener('click', () => setSub(false));
  $('mlFab').addEventListener('click', () => openCompose());
  $('mlComposeTop').addEventListener('click', () => openCompose());
  $('mlMenu').addEventListener('click', () => $('toggleSidebar').click());

  /* ---------------- فتح الصفحة ---------------- */
  function openPage(){
    mainEl.classList.remove('lib-open', 'set-open', 'pf-open', 'ch-open', 'md-open', 'vo-open', 'rs-open', 'tk-open', 'sk-open', 'mm-open'); mainEl.classList.add('ml-open');
    if (typeof closeDrawer === 'function') closeDrawer();
    if (R) closeReader();
    paintHead();
    if (S.sub) setSub(false); else load(true);
    mlStart(); mlPoll();
  }
  window.__openMail = openPage;
  window.__mlRefresh = () => { if (mainEl.classList.contains('ml-open') && !S.sub){ paintHead(); load(true); } };
  window.__mlNewMail = id => { if (mainEl.classList.contains('ml-open') && !S.sub && !R && acc() && acc().id === id && S.page === 0 && !S.q) load(true); };
  window.__mlSchedChanged = () => { if (mainEl.classList.contains('ml-open') && S.folder === SCHED) renderList(); };
  window.mlAfterAccounts = () => { S.acc = ''; S.folder = ''; S.rows = []; if (mainEl.classList.contains('ml-open') && !S.sub) load(true); paintHead(); };
  $('navMail').addEventListener('click', openPage);
  ['chatList', 'newChat', 'topNew'].forEach(id => $(id)?.addEventListener('click', () => mainEl.classList.remove('ml-open')));
  new MutationObserver(() => { if (mainEl.classList.contains('ml-open') && /\b(lib|set|pf|ch|md|vo|rs|tk|sk|mm)-open\b/.test(mainEl.className)) mainEl.classList.remove('ml-open'); })
    .observe(mainEl, { attributes:true, attributeFilter:['class'] });
  mlPaintBadge(); mlStart();
})();
