"""اختبار وحدة البريد: خادما IMAP وSMTP وهميان داخل العملية (بدون شبكة خارجية).

    python3 tests/test_mail.py
"""
import base64
import os
import re
import socketserver
import sys
import threading
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from server.gateway import mail  # noqa: E402
from server.gateway.errors import GatewayError  # noqa: E402


def raw_msg(frm, subject, body, extra="", date="Mon, 12 Oct 2026 10:00:00 +0000", ctype="text/plain; charset=utf-8"):
    return ("From: %s\r\nTo: me@example.com\r\nSubject: %s\r\nDate: %s\r\nMessage-ID: <%s@x>\r\n%sContent-Type: %s\r\n\r\n%s\r\n"
            % (frm, subject, date, abs(hash(subject)) % 10**8, extra, ctype, body)).encode("utf-8")


PDF_MSG = (b"From: Bob <bob@example.com>\r\nTo: me@example.com\r\nSubject: With file\r\nDate: Mon, 12 Oct 2026 11:00:00 +0000\r\n"
           b"MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=BB\r\n\r\n--BB\r\nContent-Type: text/plain\r\n\r\nsee attached\r\n"
           b"--BB\r\nContent-Type: application/pdf; name=\"a.pdf\"\r\nContent-Disposition: attachment; filename=\"a.pdf\"\r\n"
           b"Content-Transfer-Encoding: base64\r\n\r\n" + base64.b64encode(b"%PDF-fake") + b"\r\n--BB--\r\n")


class FakeStore:
    def __init__(self):
        self.folders = {"INBOX": {}, "Sent": {}, "Trash": {}, "Drafts": {}}
        self.next = {k: 1 for k in self.folders}
        self.flags = {k: {} for k in self.folders}
        self.smtp_inbox = []

    def add(self, folder, raw, flags=()):
        u = self.next[folder]
        self.next[folder] += 1
        self.folders[folder][u] = raw
        self.flags[folder][u] = set(flags)
        return u


STORE = FakeStore()


class IMAPH(socketserver.StreamRequestHandler):
    sel = None

    def send(self, s):
        self.wfile.write(s if isinstance(s, bytes) else s.encode("utf-8"))

    def readline_with_literals(self):
        line = self.rfile.readline()
        if not line:
            return None
        lits = []
        while True:
            m = re.search(rb"\{(\d+)\}\r\n$", line)
            if not m:
                break
            self.send(b"+ ready\r\n")
            lit = self.rfile.read(int(m.group(1)))
            lits.append(lit)
            line = line[:m.start()] + b"\x00LIT%d\x00" % (len(lits) - 1) + self.rfile.readline()
        return line.decode("utf-8", "replace").rstrip("\r\n"), lits

    def handle(self):
        self.send(b"* OK fake imap ready\r\n")
        while True:
            got = self.readline_with_literals()
            if not got:
                return
            line, lits = got
            tag, _, rest = line.partition(" ")
            cmd, _, args = rest.partition(" ")
            cmd = cmd.upper()
            if cmd == "CAPABILITY":
                self.send("* CAPABILITY IMAP4rev1 UIDPLUS MOVE\r\n%s OK done\r\n" % tag)
            elif cmd == "LOGIN":
                ok = "secret" in args
                self.send("%s %s\r\n" % (tag, "OK logged in" if ok else "NO [AUTHENTICATIONFAILED] Invalid credentials"))
            elif cmd == "NOOP":
                self.send("%s OK done\r\n" % tag)
            elif cmd == "LOGOUT":
                self.send("* BYE\r\n%s OK done\r\n" % tag)
                return
            elif cmd == "LIST":
                self.send('* LIST (\\HasNoChildren) "/" "INBOX"\r\n* LIST (\\HasNoChildren \\Sent) "/" "Sent"\r\n'
                          '* LIST (\\HasNoChildren \\Trash) "/" "Trash"\r\n* LIST (\\HasNoChildren) "/" "Drafts"\r\n'
                          '* LIST (\\HasNoChildren) "/" "&AdkB2gHhAd0-"\r\n%s OK done\r\n' % tag)
            elif cmd == "STATUS":
                f = args.split('"')[1]
                un = sum(1 for u in STORE.folders[f] if "\\Seen" not in STORE.flags[f][u])
                self.send('* STATUS "%s" (MESSAGES %d UNSEEN %d UIDNEXT %d UIDVALIDITY 7)\r\n%s OK done\r\n'
                          % (f, len(STORE.folders[f]), un, STORE.next[f], tag))
            elif cmd in ("SELECT", "EXAMINE"):
                f = args.split('"')[1]
                if f not in STORE.folders:
                    self.send("%s NO no such mailbox\r\n" % tag)
                    continue
                self.sel = f
                self.send("* %d EXISTS\r\n%s OK [READ-WRITE] done\r\n" % (len(STORE.folders[f]), tag))
            elif cmd == "UID":
                self.uid(tag, args, lits)
            elif cmd == "APPEND":
                f = args.split('"')[1]
                fl = re.search(r"\(([^)]*)\)", args)
                STORE.add(f, lits[0], fl.group(1).split() if fl else [])
                self.send("%s OK appended\r\n" % tag)
            else:
                self.send("%s BAD unknown\r\n" % tag)

    def uids_of(self, spec):
        out = []
        for part in spec.split(","):
            if ":" in part:
                a, b = part.split(":")
                out += [u for u in STORE.folders[self.sel] if int(a) <= u <= (int(b) if b != "*" else 10**9)]
            else:
                out.append(int(part))
        return out

    def uid(self, tag, args, lits):
        sub, _, rest = args.partition(" ")
        sub = sub.upper()
        f = self.sel
        if sub == "SEARCH":
            crit = rest
            for i, lit in enumerate(lits):
                crit = crit.replace("\x00LIT%d\x00" % i, '"%s"' % lit.decode("utf-8"))
            pool = list(STORE.folders[f])
            if "UNSEEN" in crit:
                pool = [u for u in pool if "\\Seen" not in STORE.flags[f][u]]
            if "FLAGGED" in crit:
                pool = [u for u in pool if "\\Flagged" in STORE.flags[f][u]]
            terms = re.findall(r'"([^"]*)"', crit)
            if terms:
                low = terms[0].lower()
                pool = [u for u in pool if low in STORE.folders[f][u].decode("utf-8", "replace").lower()]
            self.send("* SEARCH %s\r\n%s OK done\r\n" % (" ".join(map(str, sorted(pool))), tag))
        elif sub == "FETCH":
            spec, _, items = rest.partition(" ")
            for u in self.uids_of(spec):
                if u not in STORE.folders[f]:
                    continue
                raw = STORE.folders[f][u]
                fl = " ".join(sorted(STORE.flags[f][u]))
                if "BODY.PEEK[]" in items:
                    self.send(b"* 1 FETCH (UID %d BODY[] {%d}\r\n" % (u, len(raw)) + raw + b")\r\n")
                elif "HEADER.FIELDS" in items:
                    hdr = raw.split(b"\r\n\r\n")[0] + b"\r\n\r\n"
                    bs = ('("APPLICATION" "PDF" ("NAME" "a.pdf") NIL NIL "BASE64" 9 NIL ("ATTACHMENT" ("FILENAME" "a.pdf")) NIL)'
                          if b"application/pdf" in raw else '("TEXT" "PLAIN" ("CHARSET" "utf-8") NIL NIL "7BIT" 5 1)')
                    self.send(("* 1 FETCH (UID %d FLAGS (%s) BODYSTRUCTURE %s BODY[HEADER.FIELDS (X)] {%d}\r\n" % (u, fl, bs, len(hdr))).encode()
                              + hdr + b")\r\n")
                else:
                    self.send("* 1 FETCH (UID %d)\r\n" % u)
            self.send("%s OK done\r\n" % tag)
        elif sub == "STORE":
            spec, op, fl = rest.split(" ", 2)
            names = set(re.findall(r"\\\w+", fl))
            for u in self.uids_of(spec):
                if u in STORE.flags[f]:
                    if op.startswith("+"):
                        STORE.flags[f][u] |= names
                    else:
                        STORE.flags[f][u] -= names
            self.send("%s OK done\r\n" % tag)
        elif sub == "MOVE":
            spec, _, dest = rest.partition(" ")
            dest = dest.strip('"')
            for u in self.uids_of(spec):
                if u in STORE.folders[f]:
                    STORE.add(dest, STORE.folders[f].pop(u), STORE.flags[f].pop(u))
            self.send("%s OK moved\r\n" % tag)
        elif sub == "EXPUNGE":
            for u in self.uids_of(rest):
                if u in STORE.folders[f] and "\\Deleted" in STORE.flags[f][u]:
                    STORE.folders[f].pop(u)
                    STORE.flags[f].pop(u)
            self.send("%s OK expunged\r\n" % tag)
        else:
            self.send("%s BAD\r\n" % tag)


class SMTPH(socketserver.StreamRequestHandler):
    def handle(self):
        w = lambda s: self.wfile.write(s.encode())
        w("220 fake smtp\r\n")
        authed = False
        while True:
            line = self.rfile.readline().decode().strip()
            if not line:
                return
            up = line.upper()
            if up.startswith("EHLO") or up.startswith("HELO"):
                w("250-fake\r\n250 AUTH PLAIN\r\n")
            elif up.startswith("AUTH PLAIN"):
                tok = base64.b64decode(line.split()[-1]).split(b"\x00")
                authed = tok[-1] == b"secret"
                w("235 ok\r\n" if authed else "535 bad credentials\r\n")
            elif up.startswith("MAIL FROM"):
                w("250 ok\r\n")
            elif up.startswith("RCPT TO"):
                w("250 ok\r\n")
            elif up == "DATA":
                w("354 go\r\n")
                buf = b""
                while True:
                    l = self.rfile.readline()
                    if l == b".\r\n":
                        break
                    buf += l
                STORE.smtp_inbox.append(buf)
                w("250 queued\r\n")
            elif up == "QUIT":
                w("221 bye\r\n")
                return
            else:
                w("250 ok\r\n")


class Srv(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def acct(port_i, port_s, pw="secret"):
    return {"imap_host": "127.0.0.1", "imap_port": port_i, "imap_sec": "none", "smtp_host": "127.0.0.1",
            "smtp_port": port_s, "smtp_sec": "none", "user": "me@example.com", "pass": pw, "from": "me@example.com", "display": "أنا"}


class MailTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.imap = Srv(("127.0.0.1", 0), IMAPH)
        cls.smtp = Srv(("127.0.0.1", 0), SMTPH)
        for s in (cls.imap, cls.smtp):
            threading.Thread(target=s.serve_forever, daemon=True).start()
        cls.A = acct(cls.imap.server_address[1], cls.smtp.server_address[1])

    def setUp(self):
        global STORE
        STORE.__init__()
        mail._pool.clear()
        self.u1 = STORE.add("INBOX", raw_msg("Ali <ali@example.com>", "مرحبا بك", "نص عربي هنا"))
        self.u2 = STORE.add("INBOX", raw_msg("Shop <promo@shop.com>", "Big sale", "buy now",
                                             extra="List-Unsubscribe: <https://shop.com/u?x=1>, <mailto:u@shop.com?subject=unsub>\r\n"
                                                   "List-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n"), ["\\Seen"])
        self.u3 = STORE.add("INBOX", PDF_MSG)

    def run_op(self, name, **kw):
        return mail.run(name, dict(acct=self.A, **kw))

    # ------------------------------------------------------------- أدوات نقية
    def test_utf7_roundtrip(self):
        for s in ("INBOX", "مرسلة", "A & B", "Entwürfe"):
            self.assertEqual(mail.utf7_decode(mail.utf7_encode(s)), s)
        self.assertEqual(mail.utf7_encode("a&b"), "a&-b")

    def test_header_injection_rejected(self):
        with self.assertRaises(GatewayError):
            mail._clean_line("a\r\nBcc: evil@x.com", "x")
        with self.assertRaises(GatewayError):
            mail.Acct({"user": "a\nb", "imap_host": "x.com"})

    def test_blocked_hosts(self):
        for h in ("169.254.169.254", "169.254.1.5", "metadata.google.internal"):
            with self.assertRaises(GatewayError):
                mail._check_host(h)
        self.assertEqual(mail._check_host("IMAP.Example.com"), "imap.example.com")
        self.assertEqual(mail._check_host("127.0.0.1"), "127.0.0.1")  # خوادم محلية مسموحة

    def test_parse_unsub(self):
        u = mail.parse_unsub("<mailto:u@x.com?subject=bye>, <https://x.com/u>", "List-Unsubscribe=One-Click")
        self.assertEqual((u["mailto"], u["http"], u["oneclick"]), ("mailto:u@x.com?subject=bye", "https://x.com/u", True))
        self.assertFalse(mail.parse_unsub("<https://x.com/u>")["oneclick"])
        self.assertEqual(mail.parse_unsub("<javascript:alert(1)>")["http"], "")

    def test_automated_detection(self):
        self.assertTrue(mail.is_automated({"from": "noreply@x.com"}))
        self.assertTrue(mail.is_automated({"from": "a@x.com", "precedence": "bulk"}))
        self.assertTrue(mail.is_automated({"from": "a@x.com", "auto-submitted": "auto-generated"}))
        self.assertTrue(mail.is_automated({"from": "a@x.com", "list-id": "<l.x>"}))
        self.assertFalse(mail.is_automated({"from": "ali@x.com", "auto-submitted": "no"}))

    def test_strip_quoted(self):
        t = "شكرًا لك\nمع التحية\n\nOn Mon, Ali wrote:\n> قديم"
        self.assertEqual(mail.strip_quoted(t), "شكرًا لك\nمع التحية")

    def test_build_message(self):
        a = mail.Acct(self.A)
        m, rc = mail.build_message(a, {"to": "x@y.com; z@y.com", "cc": ["c@y.com"], "bcc": "b@y.com", "subject": "موضوع",
                                       "text": "hi", "html": "<p>hi</p>", "in_reply_to": "<a@b>", "references": "<z@b>",
                                       "attachments": [{"name": "f.txt", "type": "text/plain", "b64": base64.b64encode(b"data").decode()}],
                                       "auto_reply": True})
        self.assertEqual(rc, ["x@y.com", "z@y.com", "c@y.com", "b@y.com"])
        self.assertNotIn("Bcc", m)
        self.assertEqual(m["References"], "<z@b> <a@b>")
        self.assertEqual(m["Auto-Submitted"], "auto-replied")
        self.assertTrue(any(p.get_filename() == "f.txt" for p in m.walk()))

    # ------------------------------------------------------------- شبكة (خوادم وهمية)
    def test_connection_and_auth_error(self):
        r = self.run_op("test")
        self.assertTrue(r["imap"] and r["smtp"])
        bad = acct(self.imap.server_address[1], self.smtp.server_address[1], pw="wrong")
        with self.assertRaises(GatewayError) as cm:
            mail.run("test", {"acct": bad})
        self.assertEqual(cm.exception.code, "auth")

    def test_folders_roles(self):
        rows = {r["name"]: r for r in self.run_op("folders")["folders"]}
        self.assertEqual(rows["INBOX"]["role"], "inbox")
        self.assertEqual(rows["Sent"]["role"], "sent")
        self.assertEqual(rows["Trash"]["role"], "trash")
        self.assertEqual(rows["Drafts"]["role"], "drafts")
        self.assertEqual(rows["INBOX"]["unseen"], 2)
        self.assertNotEqual(rows["&AdkB2gHhAd0-"]["label"], "&AdkB2gHhAd0-")

    def test_list_and_flags(self):
        r = self.run_op("list", folder="INBOX")
        self.assertEqual([x["uid"] for x in r["rows"]], [self.u3, self.u2, self.u1])
        by = {x["uid"]: x for x in r["rows"]}
        self.assertTrue(by[self.u1]["unread"])
        self.assertFalse(by[self.u2]["unread"])
        self.assertTrue(by[self.u2]["unsub"])
        self.assertTrue(by[self.u3]["att"])
        self.assertFalse(by[self.u1]["att"])
        self.assertEqual(by[self.u1]["from"], {"name": "Ali", "addr": "ali@example.com"})
        self.assertEqual(by[self.u1]["subject"], "مرحبا بك")

    def test_list_filter_search_paging(self):
        self.assertEqual({x["uid"] for x in self.run_op("list", folder="INBOX", filter="unread")["rows"]}, {self.u1, self.u3})
        r = self.run_op("list", folder="INBOX", q="sale")
        self.assertEqual([x["uid"] for x in r["rows"]], [self.u2])
        r = self.run_op("list", folder="INBOX", q="مرحبا")          # بحث غير لاتيني عبر literal
        self.assertEqual([x["uid"] for x in r["rows"]], [self.u1])
        r = self.run_op("list", folder="INBOX", size=2)
        self.assertEqual((len(r["rows"]), r["total"], r["more"]), (2, 3, True))
        self.assertEqual(len(self.run_op("list", folder="INBOX", size=2, page=1)["rows"]), 1)
        self.assertEqual({x["uid"] for x in self.run_op("list", folder="INBOX", after_uid=self.u2)["rows"]}, {self.u3})
        with self.assertRaises(GatewayError):
            self.run_op("list", folder="INBOX", q="a\r\nb")

    def test_read_marks_seen_only_when_asked(self):
        r = self.run_op("read", folder="INBOX", uid=self.u1, mark_seen=False)
        self.assertIn("نص عربي", r["text"])
        self.assertNotIn("\\Seen", STORE.flags["INBOX"][self.u1])
        r = self.run_op("read", folder="INBOX", uid=self.u1, mark_seen=True)
        self.assertTrue(r["marked"])
        self.assertIn("\\Seen", STORE.flags["INBOX"][self.u1])
        self.assertEqual(r["from"]["addr"], "ali@example.com")
        self.assertTrue(self.run_op("read", folder="INBOX", uid=self.u2, mark_seen=False)["unsub"]["oneclick"])

    def test_attachment(self):
        r = self.run_op("read", folder="INBOX", uid=self.u3, mark_seen=False)
        self.assertEqual([(a["name"], a["type"]) for a in r["attachments"]], [("a.pdf", "application/pdf")])
        att = self.run_op("attachment", folder="INBOX", uid=self.u3, index=r["attachments"][0]["index"])
        self.assertEqual(base64.b64decode(att["b64"]), b"%PDF-fake")

    def test_send_saves_copy_and_marks_answered(self):
        r = self.run_op("send", to="x@y.com", subject="رد", text="مرحبا", reply_uid=self.u1, reply_folder="INBOX")
        self.assertTrue(r["sent"] and r["saved"] and r["answered"])
        self.assertEqual(len(STORE.smtp_inbox), 1)
        self.assertIn(b"x@y.com", STORE.smtp_inbox[0])
        self.assertEqual(len(STORE.folders["Sent"]), 1)
        self.assertIn("\\Answered", STORE.flags["INBOX"][self.u1])
        with self.assertRaises(GatewayError):
            self.run_op("send", to="", subject="s", text="t")

    def test_draft(self):
        self.run_op("draft", to="x@y.com", subject="مسودة", text="..")
        self.assertEqual(len(STORE.folders["Drafts"]), 1)
        self.assertIn("\\Draft", next(iter(STORE.flags["Drafts"].values())))

    def test_mark_move_delete(self):
        self.run_op("mark", folder="INBOX", uids=[self.u1], op="flag")
        self.assertIn("\\Flagged", STORE.flags["INBOX"][self.u1])
        self.run_op("mark", folder="INBOX", uids=[self.u2], op="unread")
        self.assertNotIn("\\Seen", STORE.flags["INBOX"][self.u2])
        # UID غير موجود لا يُفسَّر رقم تسلسل ولا يمسّ شيئًا
        self.assertEqual(self.run_op("mark", folder="INBOX", uids=[999], op="read")["done"], 0)
        self.run_op("move", folder="INBOX", uids=[self.u1], dest="Drafts")
        self.assertNotIn(self.u1, STORE.folders["INBOX"])
        self.assertEqual(len(STORE.folders["Drafts"]), 1)
        r = self.run_op("delete", folder="INBOX", uids=[self.u2])           # → سلة المحذوفات
        self.assertEqual(len(STORE.folders["Trash"]), 1)
        self.assertNotIn(self.u2, STORE.folders["INBOX"])
        mail._pool.clear()
        r = self.run_op("delete", folder="Trash", uids=[1])                  # من السلة → دائم
        self.assertTrue(r.get("permanent"))
        self.assertEqual(len(STORE.folders["Trash"]), 0)
        self.assertIn(self.u3, STORE.folders["INBOX"])                       # لم تُمسّ رسالة أخرى

    def test_spam_moves_to_junk_or_errors(self):
        with self.assertRaises(GatewayError):                                # لا مجلد junk في الخادم الوهمي
            self.run_op("mark", folder="INBOX", uids=[self.u1], op="spam")

    def test_unsub_scan(self):
        r = self.run_op("unsub_scan", folder="INBOX")
        self.assertEqual(len(r["items"]), 1)
        it = r["items"][0]
        self.assertEqual((it["sender"], it["count"], it["oneclick"]), ("promo@shop.com", 1, True))
        self.assertTrue(it["mailto"].startswith("mailto:u@shop.com"))

    def test_unsub_exec_mailto_and_open(self):
        r = self.run_op("unsub_exec", mailto="mailto:u@shop.com?subject=bye")
        self.assertEqual(r["method"], "mailto")
        self.assertIn(b"u@shop.com", STORE.smtp_inbox[-1])
        with self.assertRaises(GatewayError):                                # رابط داخلي محجوب
            self.run_op("unsub_exec", http="http://127.0.0.1/x", oneclick=True)
        with self.assertRaises(GatewayError):
            self.run_op("unsub_exec")

    def test_sent_samples(self):
        long = "مرحبا أحمد، شكرًا على رسالتك. سأراجع الملف وأعود إليك غدًا بإذن الله مع ملاحظاتي الكاملة."
        STORE.add("Sent", raw_msg("me@example.com", "رد", long + "\r\n> اقتباس قديم"))
        r = self.run_op("sent_samples", n=5)
        self.assertEqual(len(r["samples"]), 1)
        self.assertNotIn("اقتباس", r["samples"][0])


if __name__ == "__main__":
    unittest.main(verbosity=1)
