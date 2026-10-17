/* QUARK AI — عرض الرسائل وتحديث الشاشة */
'use strict';

function wireMsgs(history, proto){
  return history.map(m => {
    if (!m.images || !m.images.length) return { role:m.role, content:m.content };
    if (proto === 'anthropic')
      return { role:m.role, content:[...m.images.map(i => ({ type:'image', source:{ type:'base64', media_type:i.mime, data:i.data.split(',')[1] } })), ...(m.content ? [{ type:'text', text:m.content }] : [])] };
    return { role:m.role, content:[...(m.content ? [{ type:'text', text:m.content }] : []), ...m.images.map(i => ({ type:'image_url', image_url:{ url:i.data } }))] };
  });
}
const fmtSize = n => n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB';
const fileBlock = f => `${f.name}:\n${FENCE}${f.ext || ''}\n${f.text}\n${FENCE}`;
const fullContent = m => (m.files?.length ? m.files.map(fileBlock).join('\n\n') + (m.content ? '\n\n' : '') : '') + (m.content || '');
function chipHTML(f, i, removable){
  if (f.kind === 'image') return `<div class="att-img" data-fi="${i}" title="${esc(f.name)}"><img src="${f.data}" alt="">${removable ? `<button type="button" class="rm" data-frm="${i}" aria-label="حذف الصورة">${ic('x')}</button>` : ''}</div>`;
  return `<div class="att-chip${removable ? '' : ' ro'}" data-fi="${i}" title="${esc(f.name)}">${ic('file')}<span class="nm"><b>${esc(f.name)}</b><small>${esc(fmtSize(f.size ?? f.text.length))}</small></span>` +
    (removable ? `<button type="button" class="rm" data-frm="${i}" aria-label="حذف الملف">${ic('x')}</button>` : '') + '</div>';
}
function msgNode(m, { last = false, noanim = false, stream = false } = {}){
  if (m.role === 'assistant' && m.cmp) return cmpNode(m, { last, noanim, stream });
  const w = document.createElement('div');
  if (stream) w.dataset.live = '1';
  w.className = `msg ${m.role === 'user' ? 'user' : 'ai'}${m.error ? ' error' : ''}${noanim ? ' noanim' : ''}`;
  w._raw = m.content; w._m = m;
  if (revealedMsgs.has(m)) w.classList.add('revealed');
  if (m.role === 'user'){
    w.innerHTML = '<div class="bubble"></div>';
    w.firstChild.textContent = m.content;
    if (m.files?.length || m.imgs?.length){
      const row = document.createElement('div'); row.className = 'att-row';
      row.innerHTML = (m.imgs || []).map(i => `<img class="msg-img" data-iid="${esc(i.id)}" alt="${esc(i.name)}">`).join('') + (m.files || []).map((f, i) => chipHTML(f, i, false)).join('');
      w.insertBefore(row, w.firstChild);
      hydrateImgs(row);
      if (!m.content) w.removeChild(w.lastChild);
    }
    if (!stream){
      const a = document.createElement('div'); a.className = 'u-tools';
      const n = m.vers ? m.vers.length : 0;
      a.innerHTML = (n > 1
        ? `<div class="ver-nav"><button class="ver-b" data-ver="-1" title="النسخة السابقة"${m.vi <= 0 ? ' disabled' : ''}>›</button><span>${m.vi + 1}/${n}</span><button class="ver-b" data-ver="1" title="النسخة التالية"${m.vi >= n - 1 ? ' disabled' : ''}>‹</button></div>`
        : '') + `<button class="act" data-copymsg title="نسخ">${ic('copy')}</button><button class="act" data-edit title="تعديل الرسالة">${ic('lib-edit')}</button>`;
      w.appendChild(a);
      if (n > 1){ const bd = document.createElement('span'); bd.className = 'u-badge'; bd.textContent = `${m.vi + 1}/${n}`; w.appendChild(bd); }
    }
    return w;
  }
  w.innerHTML = '<div class="bubble"></div><div class="actions"></div>';
  const b = w.querySelector('.bubble');
  if (m.error) b.textContent = m.content; else paintBubble(b, m.thinking, m.content, false, m.thinkSecs);
  if (m.research && !stream) window.__rsDecorate?.(w, m);
  if (m.web && !stream) window.__wsDecorate?.(w, m);
  if (m.agent && !stream) window.__agDecorate?.(w, m);
  if (m.api && !stream) window.__intDecorate?.(w, m);
  if (m.skills && !stream) window.__skDecorate?.(w, m);
  if (m.mem && !stream) window.__mmDecorate?.(w, m);
  if (m.gen && m.gen.length){
    const g = document.createElement('div'); g.className = 'gen-row';
    g.innerHTML = m.gen.map(x => `<div class="gen-item"><img class="msg-img gen-img" ${x.id ? `data-iid="${esc(x.id)}"` : `src="${esc(x.url || '')}"`} alt="صورة مُولَّدة"><button type="button" class="act gen-dl" data-gdl="${esc(x.id || '')}" data-gurl="${esc(x.url || '')}" title="تنزيل">${ic('download')}</button></div>`).join('');
    b.appendChild(g); hydrateImgs(g);
  }
  if (!m.error){
    const mdl = m.model || (stream ? shortModel(activeModel()?.model) : ''), tm = m.ts ? new Date(m.ts).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }) : '';
    const hd = document.createElement('div'); hd.className = 'c-head';
    hd.innerHTML = `${ic('sparkles')}<b>${esc(mdl || 'المساعد')}</b>${tm ? `<span class="c-t">${tm}</span>` : ''}<span class="c-sp"></span>` +
      (stream ? '' : `<button class="act" data-copymsg title="نسخ">${ic('copy')}</button><button class="act" data-share title="مشاركة">${ic('share')}</button>`);
    w.insertBefore(hd, w.firstChild);
  }
  if (!stream){
    const a = w.querySelector('.actions');
    if (!m.error){
      a.innerHTML =
        `<button class="act" data-copymsg title="نسخ">${ic('copy')}</button>` +
        `<button class="act" data-share title="مشاركة">${ic('share')}</button>` +
        `<button class="act" data-speak title="قراءة بصوت عالٍ">${ic('volume')}</button>` +
        `<button class="act${m.fb === 'up' ? ' on' : ''}" data-fb="up" title="مفيد">${ic('thumb-up')}</button>` +
        `<button class="act${m.fb === 'down' ? ' on' : ''}" data-fb="down" title="غير مفيد">${ic('thumb-down')}</button>`;
    }
    if (last && !m.error){
      const q = document.createElement('div'); q.className = 'qrow';
      q.innerHTML = QUICK.map(([t, p]) => `<button type="button" data-q="${p}">${t}</button>`).join('');
      w.insertBefore(q, a);
    }
    if (last) a.innerHTML += `<button class="act" data-regen title="إعادة المحاولة">${ic('refresh')}</button>`;
    else if (a.innerHTML) a.className = 'u-tools';
    else a.remove();
  }
  return w;
}

function renderMessages(){
  const c = current();
  applyMsgStyle();
  if (thinkSheet.tk && !(busy && el.messages.contains(thinkSheet.tk))) closeThink();
  el.messages.innerHTML = '';
  el.title.textContent = c && c.messages.length ? c.title : '';
  document.querySelector('.main').classList.toggle('empty', !c || !c.messages.length);
  document.querySelector('.main').classList.toggle('incog', incog || !!c?.temp);
  $('topIncog').setAttribute('aria-pressed', String(incog));
  if (!c || !c.messages.length){
    const h = new Date().getHours();
    el.messages.innerHTML = `
      <div class="welcome">
        <h2>${h < 12 ? 'صباح الخير' : 'مساء الخير'}، كيف أساعدك اليوم؟</h2>
        ${incog ? `<p class="incog-note">${ic('ghost')}<span>محادثة خفية: لن تُحفظ في السجل، وتُحذف عند مغادرتها أو إغلاق الصفحة.</span></p>` : ''}

      </div>`;
    updateToBottom();
    window.__csRefresh?.();
    return;
  }
  c.messages.forEach((m, i) => el.messages.appendChild(
    msgNode(m, { last: i === c.messages.length - 1 && m.role === 'assistant', noanim: true })));
  if (window.__csActive?.()) window.__csRefresh(); else scrollDown(true);
}
function updateModelLabels(){
  updateCmpUI(); window.__mdRefresh?.();
}
const renderAll = () => { renderList(); renderMessages(); updateModelLabels(); };

function scrollDown(force){
  const m = el.messages;
  if (force || m.scrollHeight - m.scrollTop - m.clientHeight < 160) m.scrollTop = m.scrollHeight;
}
function updateToBottom(){
  const m = el.messages;
  el.toBottom.classList.toggle('show', m.scrollHeight - m.scrollTop - m.clientHeight > 240);
}
el.messages.addEventListener('scroll', updateToBottom, { passive:true });
el.toBottom.addEventListener('click', () => { el.messages.scrollTop = el.messages.scrollHeight; });

function newChat(){
  if (busy){ interruptGen().then(newChat); return; }
  incog = false; chats = chats.filter(c => !c.temp);
  currentId = null;
  window.applyDefaultChatModel?.();
  save(); renderAll(); closeDrawer(); el.input.focus();
}
function deleteChat(id){
  if (busy){ interruptGen().then(() => deleteChat(id)); return; }
  if (chats.find(c => c.id === id)?.temp) incog = false;
  chats = chats.filter(c => c.id !== id);
  if (currentId === id) currentId = [...chats].sort((a,b) => (b.ts||0)-(a.ts||0))[0]?.id ?? null;
  save(); renderAll();
}

