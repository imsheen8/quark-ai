/* QUARK AI — التشغيل */
'use strict';

/* ================= تشغيل ================= */
chats = chats.filter(c => c.messages.length); save();
applyTheme(); setBusy(false); paintFilter(); renderAll();
if (!activeModel() && store.get('ai_onboarded', false)) setTimeout(() => toast('ابدأ بإضافة نقطة اتصال من الإعدادات'), 700);
boot();
