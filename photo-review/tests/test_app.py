#!/usr/bin/env python3
"""Unit tests for the review app's risky logic: the path guard, the keep-or-trash validation, the capped append, the Range parser.
No browser, no server, throwaway folders only; the live data is never touched.   Run:  python3 photo-review/tests/test_app.py -v
APP_PATH=/path/to/app.py tests another copy (used to check that a deliberately broken copy fails these tests)."""
import importlib.util, io, json, os, sys, tempfile, threading, types, unittest
from unittest import mock

try:
    import fcntl  # noqa: F401
except ImportError:  # Windows: only so the app can be imported; the tests that need Linux paths are skipped there
    sys.modules['fcntl'] = types.SimpleNamespace(flock=lambda *a: None, LOCK_EX=2, LOCK_UN=8)
APP = os.environ.get('APP_PATH') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'app.py')
spec = importlib.util.spec_from_file_location('review_app', APP)
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)
linux = unittest.skipIf(os.name == 'nt', 'the app uses / paths: run these on Linux')


class Tmp(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.TemporaryDirectory()
        self.root = os.path.realpath(self.d.name)
        self.addCleanup(self.d.cleanup)

    def lines(self, name):
        with open(os.path.join(self.root, name), encoding='utf-8') as f:
            return [json.loads(x) for x in f]


@linux
class InsideTest(Tmp):  # inside(root, rel): a file path under root, or None
    def setUp(self):
        super().setUp()
        self.t = os.path.join(self.root, 'thumbs'); os.makedirs(os.path.join(self.t, 'sub'))
        os.makedirs(os.path.join(self.root, 'thumbs2'))
        for p in ('thumbs/a.webp', 'thumbs/sub/b.webp', 'thumbs2/secret.txt', 'outside.txt'):
            open(os.path.join(self.root, p), 'w').write('x')

    def test_plain_and_nested_files(self):
        self.assertEqual(app.inside(self.t, 'a.webp'), os.path.join(self.t, 'a.webp'))
        self.assertEqual(app.inside(self.t, 'sub/b.webp'), os.path.join(self.t, 'sub', 'b.webp'))

    def test_traversal_is_refused(self):
        self.assertIsNone(app.inside(self.t, '../outside.txt'))
        self.assertIsNone(app.inside(self.t, 'sub/../../outside.txt'))

    def test_absolute_path_is_refused(self):
        self.assertIsNone(app.inside(self.t, os.path.join(self.root, 'outside.txt')))

    def test_sibling_with_the_same_prefix_is_refused(self):
        self.assertIsNone(app.inside(self.t, '../thumbs2/secret.txt'))  # 'thumbs2' starts with 'thumbs'

    def test_symlink_out_of_the_root_is_refused(self):
        try:
            os.symlink(os.path.join(self.root, 'outside.txt'), os.path.join(self.t, 'link.webp'))
        except OSError:
            self.skipTest('cannot create symlinks here')
        self.assertIsNone(app.inside(self.t, 'link.webp'))

    def test_directory_and_missing_file_give_none(self):
        self.assertIsNone(app.inside(self.t, 'sub'))
        self.assertIsNone(app.inside(self.t, 'nope.webp'))


class AppendTest(Tmp):
    def setUp(self):
        super().setUp()
        p = mock.patch.object(app, 'DATA', self.root); p.start(); self.addCleanup(p.stop)

    def test_appends_whole_lines(self):
        self.assertTrue(app.append('a.jsonl', [{'n': 1}, {'n': 2}]))
        self.assertTrue(app.append('a.jsonl', [{'n': 3}]))
        self.assertEqual([r['n'] for r in self.lines('a.jsonl')], [1, 2, 3])

    def test_refuses_over_the_cap_and_leaves_the_file_alone(self):
        self.assertTrue(app.append('a.jsonl', [{'x': 'y' * 200}], cap=100))   # the file was empty, so this one fits
        size = os.path.getsize(os.path.join(self.root, 'a.jsonl'))
        self.assertFalse(app.append('a.jsonl', [{'n': 1}], cap=100))          # now over the cap
        self.assertEqual(os.path.getsize(os.path.join(self.root, 'a.jsonl')), size)

    def test_parallel_writers_never_mix_lines(self):
        def w(i): [app.append('p.jsonl', [{'w': i, 'k': k, 'pad': 'z' * 500}]) for k in range(10)]
        ts = [threading.Thread(target=w, args=(i,)) for i in range(10)]
        [t.start() for t in ts]; [t.join() for t in ts]
        self.assertEqual(len(self.lines('p.jsonl')), 100)   # every line parses (self.lines raises otherwise)


class Fake:  # just enough of the request handler for _decide
    def __init__(self, body, length=None):
        raw = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.headers = {'Content-Length': str(len(raw) if length is None else length)}
        self.rfile = io.BytesIO(raw); self.client_address = ('1.2.3.4', 1); self.code = None; self.out = None

    def send(self, code, body, *a, **k):
        self.code, self.out = code, body


class DecideTest(Tmp):  # _decide(self, src, fname): every member of a group is kept or trashed, at least one kept
    GROUP = {'id': 'g1', 'members': [{'id': 'a'}, {'id': 'b'}]}

    def setUp(self):
        super().setUp()
        p = mock.patch.object(app, 'DATA', self.root); p.start(); self.addCleanup(p.stop)
        self.src = lambda: {'index': {'g1': self.GROUP}}

    def run_decide(self, body, **kw):
        f = Fake(body, **kw); app._decide(f, self.src, 'd.jsonl'); return f

    def dec(self, keep, trash, group='g1', who='Hussam'):
        return {'who': who, 'decisions': [{'group': group, 'keep': keep, 'trash': trash}]}

    def assertRefused(self, f):
        self.assertEqual(f.code, 400, f.out)
        self.assertFalse(os.path.exists(os.path.join(self.root, 'd.jsonl')), 'nothing may be written')

    def test_valid_decision_is_saved(self):
        f = self.run_decide(self.dec(['a'], ['b']))
        self.assertEqual(f.code, 200)
        r = self.lines('d.jsonl')[0]
        self.assertEqual((r['who'], r['group'], r['keep'], r['trash'], r['client']), ('Hussam', 'g1', ['a'], ['b'], '1.2.3.4'))

    def test_keep_everything_is_fine(self):
        self.assertEqual(self.run_decide(self.dec(['a', 'b'], [])).code, 200)

    def test_nothing_kept_is_refused(self):       self.assertRefused(self.run_decide(self.dec([], ['a', 'b'])))
    def test_overlap_is_refused(self):            self.assertRefused(self.run_decide(self.dec(['a', 'b'], ['b'])))
    def test_a_member_left_out_is_refused(self):  self.assertRefused(self.run_decide(self.dec(['a'], [])))
    def test_a_stranger_is_refused(self):         self.assertRefused(self.run_decide(self.dec(['a'], ['b', 'zzz'])))
    def test_a_member_swapped_for_a_stranger_is_refused(self): self.assertRefused(self.run_decide(self.dec(['a'], ['zzz'])))  # same count, wrong ids
    def test_duplicate_ids_are_refused(self):     self.assertRefused(self.run_decide(self.dec(['a', 'a'], ['b'])))
    def test_unknown_group_is_refused(self):      self.assertRefused(self.run_decide(self.dec(['a'], ['b'], group='nope')))
    def test_unknown_person_is_refused(self):     self.assertRefused(self.run_decide(self.dec(['a'], ['b'], who='Nobody')))
    def test_no_decisions_is_refused(self):       self.assertRefused(self.run_decide({'who': 'Hussam', 'decisions': []}))
    def test_bad_json_is_refused(self):           self.assertRefused(self.run_decide(b'{not json'))
    def test_oversized_body_is_refused(self):     self.assertRefused(self.run_decide(self.dec(['a'], ['b']), length=2 << 20))

    def test_a_full_file_answers_507(self):
        with mock.patch.object(app, 'append', return_value=False):
            self.assertEqual(self.run_decide(self.dec(['a'], ['b'])).code, 507)


class FakeVideo:  # just enough of the handler for H.video
    def __init__(self, rng=None, command='GET'):
        self.headers = {'Range': rng} if rng else {}
        self.command, self.code, self.hdrs, self.wfile = command, None, {}, io.BytesIO()

    def send(self, code, body, ctype=None, extra=None): self.code = code
    def send_response(self, code): self.code = code
    def send_header(self, k, v): self.hdrs[k] = v
    def end_headers(self): pass


class RangeTest(Tmp):  # H.video on a 100-byte file whose byte i has the value i
    def setUp(self):
        super().setUp()
        self.f = os.path.join(self.root, 'v.mp4'); open(self.f, 'wb').write(bytes(range(100)))

    def get(self, rng=None, command='GET'):
        v = FakeVideo(rng, command); app.H.video(v, self.f); return v

    def test_no_range_sends_everything(self):
        v = self.get(); self.assertEqual((v.code, v.hdrs['Content-Length']), (200, '100')); self.assertEqual(v.wfile.getvalue(), bytes(range(100)))

    def test_ranges(self):
        for rng, lo, hi in (('bytes=0-9', 0, 9), ('bytes=90-', 90, 99), ('bytes=-5', 95, 99), ('bytes=0-999', 0, 99), ('bytes=-999', 0, 99), ('bytes=42-42', 42, 42)):  # '-999' = the last 999 bytes of a 100-byte file
            v = self.get(rng)
            self.assertEqual(v.code, 206, rng)
            self.assertEqual(v.hdrs['Content-Range'], f'bytes {lo}-{hi}/100', rng)
            self.assertEqual(v.wfile.getvalue(), bytes(range(lo, hi + 1)), rng)

    def test_bad_ranges_give_416_and_no_body(self):
        for rng in ('bytes=100-', 'bytes=500-600', 'bytes=50-10', 'bytes=a-b', 'bytes=-', 'items=0-5'):
            v = self.get(rng); self.assertEqual(v.code, 416, rng); self.assertEqual(v.wfile.getvalue(), b'', rng)

    def test_head_sends_no_body(self):
        v = self.get('bytes=0-9', command='HEAD'); self.assertEqual((v.code, v.wfile.getvalue()), (206, b''))


if __name__ == '__main__':
    unittest.main()
