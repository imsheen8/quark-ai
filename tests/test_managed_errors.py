"""رسائل وسيط QUARK تصل للمستخدم كما هي (دون «المفتاح مرفوض» العامة)."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))
from gateway.providers import resolve_endpoint
from gateway.errors import from_http

ep = resolve_endpoint({'url': 'https://quark.wisp.uno/qk', 'key': 'k', 'proto': 'openai'})
ok = 0
def t(n, c):
    global ok
    print(('✓ ' if c else '✗ ') + n)
    if not c: sys.exit(1)
    ok += 1
e = from_http(401, '{"error":{"message":"سجّل الدخول بحساب Google للمتابعة."}}', ep)
t('401 بلا إضافات', str(e) == 'سجّل الدخول بحساب Google للمتابعة.')
e = from_http(429, '{"error":{"message":"انتهت رسائلك اليومية (25). تتجدد غدًا."}}', ep)
t('429 بلا «انتظر قليلًا» ولا إعادة محاولة', 'انتظر' not in str(e) and not getattr(e, 'retryable', False))
BAN = 'تم إيقاف حسابك.\nالسبب: إساءة\nإن كنت ترى أن هذا خطأ فتواصل مع الدعم.'
import json
e = from_http(403, json.dumps({'error': {'message': BAN, 'code': 'banned', 'reason': 'إساءة'}}, ensure_ascii=False), ep)
t('403 حظر: الرسالة بسببها كما هي عبر البوابة (بلا «تم رفض الوصول»)', str(e) == BAN and 'مفتاح' not in str(e) and not e.retryable)
e = from_http(401, '{"error":{"message":"bad"}}', resolve_endpoint({'url': 'https://api.openai.com/v1', 'key': 'k', 'proto': 'openai'}))
t('بقية المزوّدين كما كانوا', 'المفتاح مرفوض' in str(e))
print('OK — %d' % ok)
