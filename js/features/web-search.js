/* QUARK AI — بحث الويب في المحادثة: مفتاح في قائمة (+) يبحث في الويب قبل الإجابة ويحقن النتائج في سياق النموذج مع مصادر قابلة للنقر.
   المحرك والمحركات الاحتياطية وعدد النتائج من الإعدادات ← البحث العميق (تُشارَك مع البحث العميق). */
'use strict';
(() => {
  const PAGES = 3, PAGE_CHARS = 3500, PAGE_TIMEOUT = 10000;
  let on = store.get('ai_ws_chat', false) === true;
  const sync = () => $('amWs')?.classList.toggle('on', on);
  window.wsOn = () => on;
  document.addEventListener('click', e => {
    if (e.target.closest('#amRs')){ setTimeout(() => { if ($('amRs').classList.contains('on') && on){ on = false; store.set('ai_ws_chat', false); sync(); } }, 0); return; }
    const b = e.target.closest('#amWs'); if (!b) return;
    e.stopPropagation(); closeAttach();
    on = !on; store.set('ai_ws_chat', on); sync();
    if (on && $('amRs')?.classList.contains('on')) $('amRs').click();   /* لا يجتمع مع البحث العميق */
    
  }, true);   /* طور الالتقاط: قائمة (+) توقف انتشار النقر قبل وصوله للمستند */
  sync();

  const lastUser = c => [...c.messages].reverse().find(m => m.role === 'user');
  /* استعلام البحث: نص الرسالة نفسه، أو صياغة مستقلة من السياق حين تكون المحادثة متتابعة */
  async function makeQuery(c, signal){
    const um = lastUser(c), text = String(um?.content || '').trim().replace(/\s+/g, ' ');
    const users = c.messages.filter(m => m.role === 'user').length;
    if (users < 2 || !text) return text.slice(0, 300);
    const am = (window.utilChain && window.utilChain(activeModel())[0]) || activeModel();
    if (!am) return text.slice(0, 300);
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 9000), onAb = () => ctl.abort();
    signal?.addEventListener('abort', onAb);
    try{
      const hist = c.messages.slice(-4).map(m => (m.role === 'user' ? 'المستخدم: ' : 'المساعد: ') + String(m.content || '').slice(0, 300)).join('\n');
      const out = await rsAsk(am, { signal:ctl.signal, max:80, user:`المحادثة:\n${hist}\n\nاكتب استعلام بحث ويب واحدًا قصيرًا ومستقلًا (دون الحاجة للسياق) يجلب ما يحتاجه آخر سؤال للمستخدم. أجب بالاستعلام فقط دون علامات اقتباس.` });
      const q = String(out || '').replace(/<think>[\s\S]*?<\/think>/gi, '').split('\n').map(x => x.trim()).find(Boolean) || '';
      return (q.length > 3 ? q.replace(/^["«»'`]+|["«»'`]+$/g, '') : text).slice(0, 300);
    }catch(e){ if (signal?.aborted) throw e; return text.slice(0, 300); }
    finally{ clearTimeout(t); signal?.removeEventListener('abort', onAb); }
  }
  async function readPage(url, signal){
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), PAGE_TIMEOUT), onAb = () => ctl.abort();
    signal?.addEventListener('abort', onAb);
    try{ const j = await rsGw('fetch', { url, max_chars:PAGE_CHARS }, ctl.signal); return String(j.text || '').trim(); }
    catch{ return ''; }
    finally{ clearTimeout(t); signal?.removeEventListener('abort', onAb); }
  }

  /* يُستدعى من generate(): يبحث ويضبط window.__wsCtx ويعيد قائمة المصادر */
  window.wsPrep = async (c, signal) => {
    window.__wsCtx = '';
    if (!(await gwReady())) throw new Error('بحث الويب يتطلب البوابة (python3 serve.py أو تطبيق الأندرويد).');
    const q = await makeQuery(c, signal); if (!q) return [];
    const j = await rsSearch(settings.research, q, signal);
    const top = (j.results || []).slice(0, Math.max(PAGES, Math.min(settings.research.resultCount, 8)));
    if (!top.length) return [];
    const pages = await Promise.all(top.map((r, i) => i < PAGES ? readPage(r.url, signal) : Promise.resolve('')));
    const today = new Date().toLocaleDateString('en-CA');
    window.__wsCtx = `نتائج بحث ويب حديثة (التاريخ: ${today}) للسؤال «${q}». اعتمد عليها عند الحاجة لمعلومات حديثة أو دقيقة، وأشر للمصدر برقمه مثل [1] بعد المعلومة، ولا تخترع مصادر خارج القائمة. إن لم تكفِ النتائج فاذكر ذلك صراحةً.\n\n` +
      top.map((r, i) => `[${i + 1}] ${r.title || rsHost(r.url)}\n${r.url}\n${r.snippet || ''}${pages[i] ? '\nمقتطف من الصفحة: ' + pages[i].replace(/\s+/g, ' ').slice(0, PAGE_CHARS) : ''}`).join('\n\n');
    return top.map((r, i) => ({ n:i + 1, title:r.title || rsHost(r.url), url:r.url, host:rsHost(r.url) }));
  };

  /* مصادر أسفل الرد */
  window.__wsDecorate = (w, m) => {
    if (!Array.isArray(m.web) || !m.web.length || w.querySelector('.ws-src')) return;
    const b = w.querySelector('.bubble'); if (!b) return;
    const d = document.createElement('div'); d.className = 'ws-src';
    d.innerHTML = `<div class="ws-h">${ic('globe')}<span>المصادر</span></div>` +
      m.web.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" title="${esc(s.title)}"><b>${s.n}</b><span>${esc(rsCut(s.title, 60))}</span><small dir="ltr">${esc(s.host)}</small></a>`).join('');
    b.appendChild(d);
  };
})();
