#!/usr/bin/env python3
"""Photo date review: shows groups of photos with a disputed date and records family answers.

Read-only toward Immich: thumbnails come from Immich's thumbs folder (mounted read-only),
answers are appended to /data/answers.jsonl. Applying answers to Immich is a separate step.
"""
import datetime, fcntl, json, os, re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DATA, THUMBS = '/data', '/thumbs'
PEOPLE = ['Reem', 'Mohammed', 'Hussam', 'Wissam', 'Ghazi']
HERE = os.path.dirname(os.path.abspath(__file__))
_cache = {'mtime': None, 'groups': [], 'index': {}, 'files': {}}


def groups():
    p = os.path.join(DATA, 'groups.json')
    m = os.path.getmtime(p)
    if m != _cache['mtime']:
        g = json.load(open(p, encoding='utf-8'))['groups']
        files = {}
        for grp in g:
            for a in grp['assets']:
                files[a['id']] = (a['t'], a['p'])
        _cache.update(mtime=m, groups=g, index={x['id']: x for x in g}, files=files)
    return _cache


def answers():
    p = os.path.join(DATA, 'answers.jsonl')
    if not os.path.exists(p):
        return []
    out = []
    with open(p, encoding='utf-8') as f:
        for line in f:
            try:
                out.append(json.loads(line))
            except ValueError:
                pass
    return out


class H(BaseHTTPRequestHandler):
    server_version = 'photo-review'

    def log_message(self, fmt, *args):
        if not self.path.startswith('/img/'):
            super().log_message(fmt, *args)

    def send(self, code, body, ctype='application/json; charset=utf-8', extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False)
        if isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path in ('/', '/index.html'):
            return self.send(200, open(os.path.join(HERE, 'index.html'), encoding='utf-8').read(),
                             'text/html; charset=utf-8', {'Cache-Control': 'no-store'})
        if path == '/healthz':
            return self.send(200, {'ok': True})
        if path == '/api/state':
            c = groups()
            return self.send(200, {'people': PEOPLE, 'groups': c['groups'], 'answers': answers()},
                             extra={'Cache-Control': 'no-store'})
        m = re.fullmatch(r'/img/([tp])/([0-9a-f-]{36})', path)
        if m:
            f = groups()['files'].get(m.group(2))
            if not f:
                return self.send(404, {'error': 'unknown photo'})
            rel = f[0] if m.group(1) == 't' else f[1]
            full = os.path.realpath(os.path.join(THUMBS, rel))
            if not full.startswith(THUMBS + '/') or not os.path.isfile(full):
                return self.send(404, {'error': 'missing thumbnail'})
            ctype = 'image/webp' if full.endswith('.webp') else 'image/jpeg'
            return self.send(200, open(full, 'rb').read(), ctype, {'Cache-Control': 'private, max-age=86400'})
        return self.send(404, {'error': 'not found'})

    def do_POST(self):
        if self.path != '/api/answer':
            return self.send(404, {'error': 'not found'})
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > 65536:
            return self.send(400, {'error': 'bad size'})
        try:
            d = json.loads(self.rfile.read(n))
        except ValueError:
            return self.send(400, {'error': 'bad json'})
        g = groups()['index'].get(d.get('group'))
        if not g:
            return self.send(400, {'error': 'unknown group'})
        if d.get('who') not in PEOPLE:
            return self.send(400, {'error': 'pick who is answering'})
        unsure = bool(d.get('unsure'))
        year, month = d.get('year'), d.get('month')
        if not unsure and not (isinstance(year, int) and 1950 <= year <= datetime.date.today().year):
            return self.send(400, {'error': 'year must be between 1950 and this year'})
        if month is not None and not (isinstance(month, int) and 1 <= month <= 12):
            return self.send(400, {'error': 'bad month'})
        ids = {a['id'] for a in g['assets']}
        excluded = [x for x in (d.get('excluded') or []) if x in ids]
        note = str(d.get('note') or '')[:1000]
        rec = {'ts': datetime.datetime.now().isoformat(timespec='seconds'), 'who': d['who'], 'group': g['id'],
               'tier': g.get('tier', 'year'), 'year': None if unsure else year, 'month': None if unsure else month,
               'unsure': unsure, 'excluded': excluded, 'note': note, 'client': self.client_address[0]}
        with open(os.path.join(DATA, 'answers.jsonl'), 'a', encoding='utf-8') as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            f.write(json.dumps(rec, ensure_ascii=False) + '\n')
            f.flush()
            os.fsync(f.fileno())
            fcntl.flock(f, fcntl.LOCK_UN)
        return self.send(200, {'ok': True, 'saved': rec})


if __name__ == '__main__':
    print('photo-review listening on :8080', flush=True)
    ThreadingHTTPServer(('0.0.0.0', 8080), H).serve_forever()
