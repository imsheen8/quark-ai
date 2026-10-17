/* QUARK AI — Markdown وتلوين الأكواد */
'use strict';

/* ================= Markdown + تلوين الأكواد ================= */
const KW = /^(?:function|const|let|var|return|if|else|for|while|class|import|from|export|default|new|this|async|await|try|catch|throw|def|self|lambda|None|True|False|true|false|null|undefined|public|private|static|void|int|string|bool|fn|pub|use|mut|struct|impl|package|func|type|in|of|is|not|and|or|print|echo|elif|with|as|yield|switch|case|break|continue|extends|interface|enum|typeof|instanceof|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|CREATE|TABLE|JOIN)$/;
const REST = /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_]\w*\b)/;
const RE_C = new RegExp('(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)|' + REST.source, 'g');
const RE_H = new RegExp('(#[^\\n]*)|' + REST.source, 'g');
function highlight(code, lang){
  const re = /^(python|py|bash|sh|shell|zsh|yaml|yml|ruby|rb|toml|perl)$/i.test(lang) ? RE_H : RE_C;
  re.lastIndex = 0;
  let out = '', last = 0, m;
  while ((m = re.exec(code))){
    out += esc(code.slice(last, m.index));
    const t = m[0], e = esc(t);
    if (m[1]) out += `<span class="tk-c">${e}</span>`;
    else if (m[2]) out += `<span class="tk-s">${e}</span>`;
    else if (m[3]) out += `<span class="tk-n">${e}</span>`;
    else if (KW.test(t)) out += `<span class="tk-k">${e}</span>`;
    else out += e;
    last = m.index + t.length;
  }
  return out + esc(code.slice(last));
}
function inline(s){
  s = esc(s);
  s = s.replace(/`([^`\n]+)`/g,'<code>$1</code>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g,'$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s;
}
function textBlock(s){
  const out = []; let list = null, para = [], tbl = [];
  const fp = () => { if (para.length){ out.push('<p>' + para.join('<br>') + '</p>'); para = []; } };
  const cl = () => { if (list){ out.push('</' + list + '>'); list = null; } };
  const ft = () => {
    if (!tbl.length) return;
    const cells = r => r.trim().replace(/^\||\|$/g,'').split('|').map(c => c.trim());
    let head = null, rows = tbl.slice();
    if (rows.length > 1 && /^[\s|:-]+$/.test(rows[1])){ head = cells(rows[0]); rows = rows.slice(2); }
    out.push('<div class="tbl-wrap"><table>' +
      (head ? '<thead><tr>' + head.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead>' : '') +
      '<tbody>' + rows.map(r => '<tr>' + cells(r).map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>');
    tbl = [];
  };
  for (const line of s.split('\n')){
    let m;
    if (/^\s*\|.*\|\s*$/.test(line)){ fp(); cl(); tbl.push(line); continue; }
    ft();
    if (!line.trim()){ fp(); cl(); continue; }
    if ((m = line.match(/^(#{1,3})\s+(.*)/))){ fp(); cl(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); }
    else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)){ fp(); cl(); out.push('<hr>'); }
    else if ((m = line.match(/^>\s?(.*)/))){ fp(); cl(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); }
    else if ((m = line.match(/^\s*[-*•]\s+(.*)/))){ fp(); if (list !== 'ul'){ cl(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))){ fp(); if (list !== 'ol'){ cl(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); }
    else { cl(); para.push(inline(line)); }
  }
  fp(); cl(); ft();
  return out.join('');
}
function markdown(text){
  const re = /```([\w+-]*)\n?([\s\S]*?)(```|$)/g;
  let html = '', last = 0, m;
  while ((m = re.exec(text))){
    html += textBlock(text.slice(last, m.index));
    const lang = m[1] || '', body = m[2].replace(/\n$/, ''), lt = lang.toLowerCase();
    const pv = m[3] === FENCE && (/^(html?|svg)$/.test(lt) || (!lt || lt === 'xml') && /^\s*(<svg[\s>]|<!doctype html|<html[\s>])/i.test(body));
    html += `<div class="code${m[3] === FENCE ? '' : ' streaming'}" data-lang="${esc(lt)}"><div class="code-head"><span>${esc(lang || 'code')}</span><span class="ch-acts">` +
      (pv ? `<button data-pexp hidden title="ملء الشاشة">${ic('expand')}</button><button data-prev>${ic('eye')} معاينة</button>` : '') +
      `<button data-copy>${ic('copy')} نسخ</button></span></div><pre><code>${highlight(body, lang)}</code></pre></div>`;
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  return html + textBlock(text.slice(last));
}

