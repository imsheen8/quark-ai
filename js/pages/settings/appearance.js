/* QUARK AI — المظهر والثيمات */
'use strict';

/* ----- تبويب المظهر ----- */
const mqLight = matchMedia('(prefers-color-scheme: light)');
const resolvedTheme = () => settings.theme === 'auto' ? (mqLight.matches ? 'light' : 'dark') : settings.theme;

/* الثيمات: كل ثيم يُعرَّف بأربعة ألوان ويُشتق منها بقية المتغيرات */
const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = a => '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mixC = (a, b, t) => { const x = hex2rgb(a), y = hex2rgb(b); return rgb2hex(x.map((v, i) => v + (y[i] - v) * t)); };
const lumOf = h => { const [r, g, b] = hex2rgb(h).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * b; };
const contrast = (a, b) => { const x = lumOf(a), y = lumOf(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const THEMES = [
  { id:'default',  mode:'dark',  name:'الافتراضي' },
  { id:'midnight', mode:'dark',  name:'منتصف الليل', bg:'#0f1420', surface:'#172033', text:'#e6ecf7', accent:'#5b8def' },
  { id:'forest',   mode:'dark',  name:'غابة',        bg:'#0f1a14', surface:'#16251c', text:'#e4efe7', accent:'#4f9d69' },
  { id:'violet',   mode:'dark',  name:'بنفسجي',      bg:'#17121f', surface:'#211a2e', text:'#ece6f5', accent:'#b66dd6' },
  { id:'amber',    mode:'dark',  name:'عنبر',        bg:'#1a1510', surface:'#261e16', text:'#f0e6d8', accent:'#d4a017' },
  { id:'oled',     mode:'dark',  name:'أسود نقي',    bg:'#000000', surface:'#0e0e0e', text:'#eaeaea', accent:'#e07a5f' },
  { id:'default',  mode:'light', name:'الافتراضي' },
  { id:'snow',     mode:'light', name:'ثلجي',        bg:'#f5f8fc', surface:'#ffffff', text:'#17202e', accent:'#2f6fed' },
  { id:'mint',     mode:'light', name:'نعناع',       bg:'#f1f8f4', surface:'#ffffff', text:'#15251c', accent:'#2f9e5a' },
  { id:'rose',     mode:'light', name:'وردي',        bg:'#fbf3f6', surface:'#ffffff', text:'#2a1a21', accent:'#d6457a' },
  { id:'paper',    mode:'light', name:'ورقي',        bg:'#f6efe0', surface:'#fffaf0', text:'#2d2415', accent:'#b7791f' },
  { id:'white',    mode:'light', name:'أبيض نقي',    bg:'#ffffff', surface:'#f4f4f5', text:'#111111', accent:'#d97757' },
];
const BASE_COLORS = {
  dark:  { bg:'#161616', surface:'#1c1c1c', text:'#ececec', accent:'#e07a5f' },
  light: { bg:'#faf9f5', surface:'#ffffff', text:'#1f1e1c', accent:'#d97757' },
};
const THEME_KEYS = ['--bg','--sidebar','--surface','--surface-2','--surface-3','--text','--text-2','--muted','--border','--bubble','--accent','--accent-soft','--primary','--on-primary','--on-accent','--code-bg','--code-head','--code-bd','--code-fg','--code-mute','--code-btn','--code-hover','--code-hover-fg','--tk-c','--tk-s','--tk-n','--tk-k'];
const DEF_VARS = {
  dark:  { bg:'#161616', sb:'#101010', s:'#1c1c1c', s2:'#2a2a2a', t:'#ececec', a:'#e07a5f' },
  light: { bg:'#faf9f5', sb:'#f3f1ea', s:'#ffffff', s2:'#ece9df', t:'#1f1e1c', a:'#d97757' },
};
function themeVars(t){
  const dark = t.mode === 'dark', [r, g, b] = hex2rgb(t.accent), s2 = mixC(t.surface, t.text, .08), oa = onAccent(t.accent);
  const cb = dark ? mixC(t.bg, '#000000', .45) : mixC(t.bg, t.text, .05);
  const v = {
    '--bg':t.bg, '--sidebar':dark ? mixC(t.bg, '#000000', .35) : mixC(t.bg, '#000000', .04),
    '--surface':t.surface, '--surface-2':s2, '--surface-3':mixC(t.surface, t.text, .16),
    '--text':t.text, '--text-2':mixC(t.text, t.bg, .30), '--muted':mixC(t.text, t.bg, .52),
    '--border':mixC(t.bg, t.text, .12), '--bubble':s2,
    '--accent':t.accent, '--accent-soft':`rgba(${r},${g},${b},.15)`,
    /* الأزرار الرئيسية تتبع اللون المميز بدل الأبيض/الأسود الثابت */
    '--primary':t.accent, '--on-primary':oa, '--on-accent':oa,
    '--code-bg':cb, '--code-head':dark ? mixC(cb, t.text, .06) : mixC(t.bg, t.text, .10), '--code-bd':dark ? mixC(cb, t.text, .12) : mixC(t.bg, t.text, .16),
    '--code-fg':dark ? mixC(t.text, cb, .1) : t.text, '--code-mute':mixC(t.text, cb, .5), '--code-btn':mixC(t.text, cb, .35),
    '--code-hover':dark ? mixC(cb, t.text, .12) : mixC(t.bg, t.text, .16), '--code-hover-fg':t.text,
  };
  if (dark) Object.assign(v, { '--tk-c':'#6f7a8c', '--tk-s':'#a5e075', '--tk-n':'#f8a56b', '--tk-k':'#e0a0ff' });
  else Object.assign(v, { '--tk-c':'#6b7585', '--tk-s':'#2f7d32', '--tk-n':'#c25b12', '--tk-k':'#8a3fc2' });
  return v;
}
const allThemes = mode => [...THEMES.filter(t => t.mode === mode), ...settings.customThemes.filter(t => t.mode === mode)];
const themeOf = mode => { const id = settings.themeSel[mode] || 'default'; return allThemes(mode).find(t => t.id === id) || THEMES.find(t => t.mode === mode && t.id === 'default'); };
const onAccent = h => lumOf(h) > .42 ? '#111111' : '#ffffff';

function themeCard(t, mode){
  const custom = t.id.startsWith('c_'), on = (settings.themeSel[mode] || 'default') === t.id;
  let c;
  if (t.id === 'default') c = DEF_VARS[mode];
  else { const v = themeVars(t); c = { bg:v['--bg'], sb:v['--sidebar'], s:v['--surface'], s2:v['--surface-2'], t:v['--text'], a:v['--accent'] }; }
  return `<div class="th-card${on ? ' on' : ''}" role="button" tabindex="0" data-th="${t.id}" data-mode="${mode}" aria-pressed="${on}" style="--b:${c.bg};--sb:${c.sb};--s:${c.s};--s2:${c.s2};--t:${c.t};--a:${c.a};--oa:${onAccent(c.a)}">` +
    `<span class="th-pv"><i class="pv-side"></i><i class="pv-bub"></i><i class="pv-l1"></i><i class="pv-l2"></i><i class="pv-bar"></i><span class="th-chk">${ic('check')}</span></span><span class="th-n">${esc(t.name)}</span>` +
    (custom ? `<button type="button" class="th-ed" data-edit="${t.id}" aria-label="تعديل الثيم">${ic('lib-edit')}</button>` : '') + '</div>';
}
function renderThemes(){
  const modes = [resolvedTheme()];   /* «تلقائي»: نعرض ثيمات الوضع الحالي للجهاز فقط (داكن أو فاتح) */
  $('themeBox').innerHTML = modes.map(m => {
    const title = settings.theme === 'auto' ? (m === 'dark' ? 'ثيم الوضع الداكن (الحالي)' : 'ثيم الوضع الفاتح (الحالي)') : (m === 'dark' ? 'ثيمات داكنة' : 'ثيمات فاتحة');
    return `<div class="th-group"><span class="lbl">${ic('sparkles')} ${title}</span><div class="th-grid">${allThemes(m).map(t => themeCard(t, m)).join('')}</div>` +
      `<button type="button" class="th-new" data-new="${m}">${isPro() || settings.customThemes.length < FREE_THEMES ? ic('plus') + ' إنشاء ثيم مخصص' : ic('lock') + ' إنشاء ثيم مخصص — برو'}</button></div>`;
  }).join('') + (settings.theme === 'auto' ? '<p class="panel-desc">يتبدّل الثيم تلقائيًا مع وضع جهازك، وتظهر هنا ثيمات الوضع الحالي فقط.</p>' : '');
}
function syncLook(){
  $('themeSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tmode === settings.theme));
  $('sizeSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.size === settings.fontSize));
  applyMsgStyle();
  renderThemes();
}
function applyMsgStyle(){ document.documentElement.dataset.msgstyle = 'plain'; }
function applyTheme(){
  const t = resolvedTheme(), th = themeOf(t), st = document.documentElement.style;
  document.documentElement.dataset.theme = t;
  applyMsgStyle();
  { const d = document.documentElement.dataset, c = settings.cont;
    d.cstripe = c.stripe; d.csep = c.sep ? '1' : '0'; d.cspoiler = c.spoiler ? '1' : '0'; d.cactions = c.actions ? '1' : '0';
    d.cheader = c.header ? '1' : '0'; d.csec = c.sections ? '1' : '0'; d.cuser = c.user ? '1' : '0'; d.calpha = c.alpha;
    st.setProperty('--c-r', { sharp:'6px', round:'22px', pill:'34px' }[c.radius]);
    st.setProperty('--c-pad', { sharp:'16px 18px 10px', round:'18px 20px 12px', pill:'22px 26px 14px' }[c.radius]);
    st.setProperty('--c-bw', { none:'0px', thin:'1px', bold:'2px' }[c.bw]);
    st.setProperty('--c-bg', { solid:'var(--surface)', soft:'color-mix(in srgb, var(--surface) 55%, transparent)', glass:'color-mix(in srgb, var(--surface) 28%, transparent)' }[c.alpha]);
    st.setProperty('--c-stripe', c.stripe === 'custom' ? c.color : 'var(--accent)'); }
  THEME_KEYS.forEach(k => st.removeProperty(k));
  const custom = th && th.id !== 'default';
  if (custom) Object.entries(themeVars(th)).forEach(([k, v]) => st.setProperty(k, v));
  document.querySelector('meta[name=theme-color]').content = custom ? th.bg : (t === 'dark' ? '#161616' : '#faf9f5');
  st.setProperty('--fs', { sm:.9, md:1, lg:1.12 }[settings.fontSize] || 1);
  syncLook();
}
if (mqLight.addEventListener) mqLight.addEventListener('change', () => { if (settings.theme === 'auto'){ applyTheme(); renderThemes(); } });
$('themeSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  settings.theme = b.dataset.tmode; persistSettings(); applyTheme();
});

