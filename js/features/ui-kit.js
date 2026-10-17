/* QUARK AI — واجهات من تصميم التطبيق بدل نوافذ النظام:
   تأكيد (بدل confirm)، قوائم اختيار (بدل <select>)، منتقي ألوان (بدل input[type=color])، واقتراحات (بدل datalist). */
'use strict';
(() => {
  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const xIcon = () => (typeof ic === 'function' ? ic('x') : '×');

  /* ---------- طبقة منبثقة عامة (تُغلق بـ Escape وزر الرجوع) ---------- */
  function openLayer(cls, html, onClose){
    const ov = document.createElement('div');
    ov.className = cls + ' show';
    ov.innerHTML = html;
    let closed = false;
    const onKey = e => { if (e.key === 'Escape'){ e.stopImmediatePropagation(); e.preventDefault(); close(); } };
    function close(val){
      if (closed) return; closed = true;
      document.removeEventListener('keydown', onKey, true);
      ov.remove();
      if (onClose) onClose(val);
    }
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(ov);
    return { ov, close };
  }

  /* ================= نافذة التأكيد ================= */
  window.qConfirm = (msg, o = {}) => new Promise(res => {
    const { ov, close } = openLayer('lib-ov q-confirm',
      `<div class="lib-dlg q-dlg" role="alertdialog" aria-modal="true">${o.title ? `<h2>${E(o.title)}</h2>` : ''}` +
      `<p class="q-msg">${E(msg)}</p>` +
      `<div class="lib-acts"><button type="button" class="lib-btn" data-q="0">${E(o.cancel || 'إلغاء')}</button>` +
      `<button type="button" class="lib-btn pri${o.danger === false ? '' : ' danger'}" data-q="1">${E(o.ok || 'تأكيد')}</button></div></div>`,
      v => res(v === true));
    ov.addEventListener('click', e => {
      if (e.target === ov){ close(false); return; }
      const b = e.target.closest('[data-q]'); if (b) close(b.dataset.q === '1');
    });
  });

  /* ================= قوائم الاختيار ================= */
  const selValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  const selIndex = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');

  function enhanceSelect(sel){
    if (sel.dataset.qs) return; sel.dataset.qs = '1';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = sel.className + ' q-sel';
    btn.setAttribute('aria-haspopup', 'listbox');
    const al = sel.getAttribute('aria-label'); if (al) btn.setAttribute('aria-label', al);
    sel.classList.add('q-native'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
    sel.after(btn);
    const refresh = () => {
      const o = sel.options[sel.selectedIndex];
      btn.textContent = o ? o.textContent.trim() : '—';
      btn.disabled = sel.disabled; btn.hidden = sel.hidden;
    };
    Object.defineProperty(sel, 'value', { configurable:true, get(){ return selValue.get.call(this); }, set(v){ selValue.set.call(this, v); refresh(); } });
    Object.defineProperty(sel, 'selectedIndex', { configurable:true, get(){ return selIndex.get.call(this); }, set(v){ selIndex.set.call(this, v); refresh(); } });
    new MutationObserver(refresh).observe(sel, { childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['disabled', 'hidden'] });
    sel.addEventListener('change', refresh);
    refresh();
    btn.addEventListener('click', () => openSelect(sel, refresh));
  }

  function selectTitle(sel){
    const al = sel.getAttribute('aria-label'); if (al) return al;
    const lb = sel.closest('label');
    if (lb){ const t = [...lb.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim(); if (t) return t; }
    return 'اختيار';
  }

  function openSelect(sel, refresh){
    const title = selectTitle(sel);
    let html = '';
    const add = o => {
      html += `<button type="button" class="q-opt${o.index === sel.selectedIndex ? ' on' : ''}" data-i="${o.index}"${o.disabled ? ' disabled' : ''}>` +
        `<span>${E(o.textContent.trim())}</span><span class="q-radio"></span></button>`;
    };
    [...sel.children].forEach(ch => {
      if (ch.tagName === 'OPTGROUP'){ html += `<div class="q-grp">${E(ch.label)}</div>`; [...ch.children].forEach(add); }
      else if (ch.tagName === 'OPTION') add(ch);
    });
    const { ov, close } = openLayer('sheet-ov q-sheet',
      `<div class="sheet" role="dialog" aria-label="${E(title)}"><div class="sheet-handle"></div>` +
      `<div class="sheet-head"><span></span><h3>${E(title)}</h3><button type="button" class="sheet-x" data-qx aria-label="إغلاق">${xIcon()}</button></div>` +
      `<div class="sheet-body q-list" role="listbox">${html}</div></div>`);
    ov.addEventListener('click', e => {
      if (e.target === ov || e.target.closest('[data-qx]')){ close(); return; }
      const b = e.target.closest('.q-opt'); if (!b || b.disabled) return;
      const i = +b.dataset.i;
      if (i !== sel.selectedIndex){
        selIndex.set.call(sel, i); refresh();
        sel.dispatchEvent(new Event('input', { bubbles:true }));
        sel.dispatchEvent(new Event('change', { bubbles:true }));
      }
      close();
    });
    const on = ov.querySelector('.q-opt.on'); if (on) on.scrollIntoView({ block:'center' });
  }

  /* ================= منتقي الألوان ================= */
  const inpValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  const hex2hsl = hex => {
    const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
    let h = 0, s = 0;
    if (d){
      s = d / (1 - Math.abs(2 * l - 1));
      h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    return { h, s:s * 100, l:l * 100 };
  };
  const hsl2hex = (h, s, l) => {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
    return '#' + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join('');
  };
  const PALETTE = (() => {
    const out = ['#000000', '#161616', '#2a2a2a', '#666666', '#999999', '#ddd9cf', '#f5f2ea', '#ffffff'];
    [30, 48, 66, 82].forEach(l => { for (let h = 0; h < 360; h += 30) out.push(hsl2hex(h, 70, l)); });
    return out;
  })();

  function enhanceColor(inp){
    if (inp.dataset.qc) return; inp.dataset.qc = '1';
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'q-color'; btn.setAttribute('aria-label', 'اختيار لون');
    inp.classList.add('q-native'); inp.tabIndex = -1; inp.setAttribute('aria-hidden', 'true');
    inp.after(btn);
    const refresh = () => btn.style.setProperty('--q-c', inp.value || '#000000');
    Object.defineProperty(inp, 'value', { configurable:true, get(){ return inpValue.get.call(this); }, set(v){ inpValue.set.call(this, v); refresh(); } });
    refresh();
    btn.addEventListener('click', () => openColor(inp, refresh));
  }

  function openColor(inp, refresh){
    const start = /^#[0-9a-f]{6}$/i.test(inp.value) ? inp.value.toLowerCase() : '#000000';
    let cur = hex2hsl(start), hex = start, changed = false;
    const sw = PALETTE.map(c => `<button type="button" class="q-swatch" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('');
    const { ov, close } = openLayer('sheet-ov q-sheet',
      `<div class="sheet q-clr" role="dialog" aria-label="اختيار لون"><div class="sheet-handle"></div>` +
      `<div class="sheet-head"><span></span><h3>اختيار لون</h3><button type="button" class="sheet-x" data-qx aria-label="إغلاق">${xIcon()}</button></div>` +
      `<div class="sheet-body">` +
      `<div class="q-prev"><span class="q-chip"></span><input class="fld q-hex" dir="ltr" maxlength="7" spellcheck="false" autocomplete="off" aria-label="رمز اللون"></div>` +
      `<div class="q-sw">${sw}</div>` +
      `<label class="q-sl"><span>الدرجة</span><input type="range" min="0" max="360" step="1" data-k="h" class="q-r q-hue"></label>` +
      `<label class="q-sl"><span>التشبّع</span><input type="range" min="0" max="100" step="1" data-k="s" class="q-r"></label>` +
      `<label class="q-sl"><span>السطوع</span><input type="range" min="0" max="100" step="1" data-k="l" class="q-r"></label>` +
      `<div class="lib-acts"><button type="button" class="lib-btn pri" data-qx>تم</button></div>` +
      `</div></div>`,
      () => { if (changed) inp.dispatchEvent(new Event('change', { bubbles:true })); });
    const chip = ov.querySelector('.q-chip'), hexIn = ov.querySelector('.q-hex'), rs = {};
    ov.querySelectorAll('.q-r').forEach(r => rs[r.dataset.k] = r);
    const paint = (skipHex) => {
      chip.style.background = hex;
      if (!skipHex) hexIn.value = hex;
      rs.h.value = Math.round(cur.h); rs.s.value = Math.round(cur.s); rs.l.value = Math.round(cur.l);
      rs.s.style.background = `linear-gradient(to right, ${hsl2hex(cur.h, 0, cur.l)}, ${hsl2hex(cur.h, 100, cur.l)})`;
      rs.l.style.background = `linear-gradient(to right, #000, ${hsl2hex(cur.h, cur.s, 50)}, #fff)`;
    };
    const apply = (h, fromHsl) => {
      hex = h.toLowerCase();
      if (!fromHsl) cur = hex2hsl(hex);
      inpValue.set.call(inp, hex); refresh(); changed = true;
      inp.dispatchEvent(new Event('input', { bubbles:true }));
    };
    paint();
    ov.addEventListener('click', e => {
      if (e.target === ov || e.target.closest('[data-qx]')){ close(); return; }
      const s = e.target.closest('.q-swatch'); if (s){ apply(s.dataset.c); paint(); }
    });
    ov.addEventListener('input', e => {
      const r = e.target.closest('.q-r');
      if (r){ cur[r.dataset.k] = +r.value; apply(hsl2hex(cur.h, cur.s, cur.l), true); paint(); return; }
      if (e.target === hexIn){
        let v = hexIn.value.trim(); if (v && v[0] !== '#') v = '#' + v;
        if (/^#[0-9a-f]{6}$/i.test(v)){ apply(v); paint(true); }
      }
    });
  }

  /* ================= اقتراحات الكتابة (بدل datalist) ================= */
  function enhanceList(inp){
    if (inp.dataset.ql) return;
    const id = inp.getAttribute('list'); if (!id) return;
    inp.dataset.ql = id; inp.removeAttribute('list'); inp.setAttribute('autocomplete', 'off');
    let box = null, skip = false;
    const hide = () => { if (box){ box.remove(); box = null; } };
    const show = () => {
      if (skip){ skip = false; return; }
      const dl = document.getElementById(id), q = inp.value.trim().toLowerCase();
      const items = [...((dl && dl.options) || [])].map(o => o.value).filter(v => !q || v.toLowerCase().includes(q)).slice(0, 8);
      if (!items.length || (items.length === 1 && items[0] === inp.value)){ hide(); return; }
      if (!box){
        box = document.createElement('div'); box.className = 'q-suggest';
        box.addEventListener('pointerdown', e => {
          const b = e.target.closest('[data-v]'); if (!b) return;
          e.preventDefault(); skip = true;
          inp.value = b.dataset.v; inp.dispatchEvent(new Event('input', { bubbles:true })); hide();
        });
        document.body.appendChild(box);
      }
      box.innerHTML = items.map(v => `<button type="button" data-v="${E(v)}">${E(v)}</button>`).join('');
      const r = inp.getBoundingClientRect();
      box.style.left = r.left + 'px'; box.style.width = r.width + 'px';
      if (r.bottom + 240 > innerHeight && r.top > 240){ box.style.top = ''; box.style.bottom = (innerHeight - r.top + 4) + 'px'; }
      else { box.style.bottom = ''; box.style.top = (r.bottom + 4) + 'px'; }
    };
    inp.addEventListener('focus', show);
    inp.addEventListener('input', show);
    inp.addEventListener('blur', () => setTimeout(hide, 120));
    inp.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
    window.addEventListener('resize', hide);
  }

  /* ================= مسح العناصر الموجودة والمضافة لاحقًا ================= */
  function scan(root){
    if (!root || root.nodeType !== 1) return;
    const q = (sel, fn) => { if (root.matches && root.matches(sel)) fn(root); root.querySelectorAll(sel).forEach(fn); };
    q('select:not(.q-native)', enhanceSelect);
    q('input[type=color]:not(.q-native)', enhanceColor);
    q('input[list]:not([data-ql])', enhanceList);
    q('input[type=text]:not([autocomplete]),input:not([type]):not([autocomplete]),input[type=search]:not([autocomplete])', i => i.setAttribute('autocomplete', 'off'));
  }
  scan(document.body);
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(scan))).observe(document.body, { childList:true, subtree:true });
})();
