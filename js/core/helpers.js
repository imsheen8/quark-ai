/* QUARK AI — دوال مساعدة ومراجع العناصر (el, $, ic) */
'use strict';

const $ = (id) => document.getElementById(id);
const ic = (n, c = '') => `<svg class="i ${c}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const el = {
  app:$('app'), sidebar:$('sidebar'), backdrop:$('backdrop'), chatList:$('chatList'), chatSearch:$('chatSearch'),
  messages:$('messages'), toBottom:$('toBottom'), input:$('input'), send:$('sendBtn'), title:$('chatTitle'),
  toast:$('toast'), modal:$('modal'), baseUrl:$('baseUrl'),
 model:$('model'), modelList:$('modelList'), quick:$('quick'),
  systemPrompt:$('systemPrompt'), seg:$('seg'),
  popList:$('popList'), modelSearch:$('modelSearch'), 
};
const FENCE = '\u0060\u0060\u0060';

