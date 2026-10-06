#!/usr/bin/env python3
"""Family review page: shows groups of photos/videos and records family answers.

Question kinds: 'date' (what year/month?) and 'owner' (whose camera / whose videos?).
Read-only toward Immich: thumbnails, transcoded videos and originals come from Immich's
folders (all mounted read-only); answers are appended to /data/answers.jsonl.
Applying answers to Immich is a separate, logged step.
"""
import datetime, fcntl, json, os, random, re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

DATA, THUMBS, ENC, ORIG = '/data', '/thumbs', '/enc', '/orig'
PEOPLE = ['Reem', 'Mohammed', 'Hussam', 'Wissam', 'Ghazi']
OWNERS = PEOPLE + ['Family', 'Someone else']
VTYPES = {'mp4': 'video/mp4', 'mov': 'video/mp4', 'm4v': 'video/mp4', '3gp': 'video/3gpp', 'mkv': 'video/x-matroska'}
CHUNK = 256 * 1024
FIRST, MAXPAGE = 60, 240  # items sent per group up front / per 'show more'
HERE = os.path.dirname(os.path.abspath(__file__))
_cache = {'mtime': None, 'doc': {}, 'groups': [], 'light': [], 'index': {}, 'files': {}}
_dcache = {'mtime': None, 'groups': [], 'index': {}, 'files': {}}


def dups():
    p = os.path.join(DATA, 'dups.json')
    if not os.path.exists(p):
        return _dcache
    m = os.path.getmtime(p)
    if m != _dcache['mtime']:
        g = json.load(open(p, encoding='utf-8'))['groups']
        files = {a['id']: (a['t'], a['p'], a.get('v')) for x in g for a in x['members']}
        _dcache.update(mtime=m, groups=g, index={x['id']: x for x in g}, files=files)
    return _dcache


def fileinfo(aid):
    return groups()['files'].get(aid) or dups()['files'].get(aid)



def groups():
    p = os.path.join(DATA, 'groups.json')
    m = os.path.getmtime(p)
    if m != _cache['mtime']:
        doc = json.load(open(p, encoding='utf-8'))
        g = doc['groups']
        files = {}
        for grp in g:
            for a in grp['assets']:
                files[a['id']] = (a['t'], a['p'], a.get('v'))
        light = [dict(x, assets=x['assets'][:FIRST], total=len(x['assets'])) for x in g]
        _cache.update(mtime=m, doc=doc, groups=g, light=light, index={x['id']: x for x in g}, files=files)
    return _cache


def answers(name='answers.jsonl'):
    p = os.path.join(DATA, name)
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


def inside(root, rel):
    full = os.path.realpath(os.path.join(root, rel))
    return full if full.startswith(root + '/') and os.path.isfile(full) else None


class H(BaseHTTPRequestHandler):
    server_version = 'photo-review'

    def log_message(self, fmt, *args):
        if not (self.path.startswith('/img/') or self.path.startswith('/vid/')):
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
        if self.command != 'HEAD':
            self.wfile.write(body)

    def video(self, full):
        size = os.path.getsize(full)
        ctype = VTYPES.get(full.rsplit('.', 1)[-1].lower(), 'application/octet-stream')
        start, end, code = 0, size - 1, 200
        rng = self.headers.get('Range')
        if rng:
            m = re.fullmatch(r'bytes=(\d*)-(\d*)', rng.strip())
            if not m or (m.group(1) == '' and m.group(2) == ''):
                return self.send(416, {'error': 'bad range'}, extra={'Content-Range': f'bytes */{size}'})
            if m.group(1) == '':
                start = max(0, size - int(m.group(2)))
            else:
                start = int(m.group(1))
                if m.group(2):
                    end = min(int(m.group(2)), size - 1)
            if start >= size or start > end:
                return self.send(416, {'error': 'bad range'}, extra={'Content-Range': f'bytes */{size}'})
            code = 206
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Length', str(end - start + 1))
        self.send_header('Cache-Control', 'private, max-age=86400')
        if code == 206:
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.end_headers()
        if self.command == 'HEAD':
            return
        try:
            with open(full, 'rb') as f:
                f.seek(start)
                left = end - start + 1
                while left > 0:
                    buf = f.read(min(CHUNK, left))
                    if not buf:
                        break
                    self.wfile.write(buf)
                    left -= len(buf)
        except (BrokenPipeError, ConnectionResetError):
            pass  # the browser stopped reading (seek / closed the player)

    def do_HEAD(self):
        return self.do_GET()

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path in ('/dups', '/dups.html'):
            return self.send(200, open(os.path.join(HERE, 'dups.html'), encoding='utf-8').read(),
                             'text/html; charset=utf-8', {'Cache-Control': 'no-store'})
        if path == '/api/dups/state':  # only bursts and disputed dates are reviewed; copies follow the rule
            g = [x for x in dups()['groups'] if x['cls'] != 'copy']
            ids = {x['id'] for x in g}
            return self.send(200, {'people': PEOPLE, 'groups': g, 'copies': len(dups()['groups']) - len(g),
                                   'answers': [a for a in answers('dup_answers.jsonl') if a.get('group') in ids]},
                             extra={'Cache-Control': 'no-store'})
        if path == '/api/dups/spot':  # read-only: random copy groups, to eyeball the automatic choice
            c = [x for x in dups()['groups'] if x['cls'] == 'copy']
            return self.send(200, {'groups': random.sample(c, min(20, len(c)))}, extra={'Cache-Control': 'no-store'})
        if path in ('/', '/index.html'):
            return self.send(200, open(os.path.join(HERE, 'index.html'), encoding='utf-8').read(),
                             'text/html; charset=utf-8', {'Cache-Control': 'no-store'})
        if path == '/healthz':
            return self.send(200, {'ok': True})
        if path == '/api/state':
            c = groups()
            return self.send(200, {'people': PEOPLE, 'owners': OWNERS, 'round_title': c['doc'].get('round_title', ''),
                                   'groups': c['light'], 'answers': answers()}, extra={'Cache-Control': 'no-store'})
        if path == '/api/more':
            qs = {k: v[0] for k, v in parse_qs(urlsplit(self.path).query).items()}
            g = groups()['index'].get(qs.get('g', ''))
            try:
                o, n = int(qs.get('o', 0)), min(int(qs.get('n', 120)), MAXPAGE)
            except ValueError:
                return self.send(400, {'error': 'bad numbers'})
            if not g or o < 0 or n <= 0:
                return self.send(400, {'error': 'unknown group'})
            return self.send(200, {'assets': g['assets'][o:o + n], 'total': len(g['assets'])})
        m = re.fullmatch(r'/img/([tp])/([0-9a-f-]{36})', path)
        if m:
            f = fileinfo(m.group(2))
            if not f:
                return self.send(404, {'error': 'unknown photo'})
            full = inside(THUMBS, f[0] if m.group(1) == 't' else f[1])
            if not full:
                return self.send(404, {'error': 'missing thumbnail'})
            ctype = 'image/webp' if full.endswith('.webp') else 'image/jpeg'
            return self.send(200, open(full, 'rb').read(), ctype, {'Cache-Control': 'private, max-age=86400'})
        m = re.fullmatch(r'/vid/([0-9a-f-]{36})', path)
        if m:
            f = fileinfo(m.group(1))
            if not f or not f[2]:
                return self.send(404, {'error': 'unknown video'})
            kind, rel = f[2]
            full = inside(ENC if kind == 'enc' else ORIG, rel)
            if not full:
                return self.send(404, {'error': 'missing video'})
            return self.video(full)
        return self.send(404, {'error': 'not found'})

    def do_POST(self):
        if self.path == '/api/dups/decide':
            return self.decide()
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
        ids = {a['id'] for a in g['assets']}
        excluded = [x for x in (d.get('excluded') or []) if x in ids]
        note = str(d.get('note') or '')[:1000]
        rec = {'ts': datetime.datetime.now().isoformat(timespec='seconds'), 'who': d['who'], 'group': g['id'],
               'kind': g.get('kind', 'date'), 'unsure': unsure, 'excluded': excluded, 'note': note,
               'client': self.client_address[0]}
        if rec['kind'] == 'owner':
            owners = d.get('owners') or []
            if not isinstance(owners, list) or any(o not in OWNERS for o in owners) or len(set(owners)) != len(owners):
                return self.send(400, {'error': 'bad owners'})
            if not unsure and not owners:
                return self.send(400, {'error': 'pick at least one person, or "Not sure"'})
            rec['owners'] = [] if unsure else owners
        else:
            year, month = d.get('year'), d.get('month')
            if not unsure and not (isinstance(year, int) and 1950 <= year <= datetime.date.today().year):
                return self.send(400, {'error': 'year must be between 1950 and this year'})
            if month is not None and not (isinstance(month, int) and 1 <= month <= 12):
                return self.send(400, {'error': 'bad month'})
            rec.update(tier=g.get('tier', 'year'), year=None if unsure else year, month=None if unsure else month)
        with open(os.path.join(DATA, 'answers.jsonl'), 'a', encoding='utf-8') as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            f.write(json.dumps(rec, ensure_ascii=False) + '\n')
            f.flush()
            os.fsync(f.fileno())
            fcntl.flock(f, fcntl.LOCK_UN)
        return self.send(200, {'ok': True, 'saved': rec})


def _decide(self):
    n = int(self.headers.get('Content-Length') or 0)
    if n <= 0 or n > 1 << 20:
        return self.send(400, {'error': 'bad size'})
    try:
        d = json.loads(self.rfile.read(n))
    except ValueError:
        return self.send(400, {'error': 'bad json'})
    if d.get('who') not in PEOPLE:
        return self.send(400, {'error': 'pick who is answering'})
    idx, recs, ts = dups()['index'], [], datetime.datetime.now().isoformat(timespec='seconds')
    for x in d.get('decisions') or []:
        g = idx.get(x.get('group'))
        if not g:
            return self.send(400, {'error': 'unknown group'})
        ids = {a['id'] for a in g['members']}
        keep, trash = x.get('keep') or [], x.get('trash') or []
        if not keep or set(keep) & set(trash) or set(keep) | set(trash) != ids or len(keep) + len(trash) != len(ids):
            return self.send(400, {'error': 'every item must be either kept or trashed, at least one kept'})
        recs.append({'ts': ts, 'who': d['who'], 'group': g['id'], 'keep': keep, 'trash': trash,
                     'note': str(x.get('note') or '')[:500], 'client': self.client_address[0]})
    if not recs:
        return self.send(400, {'error': 'nothing to save'})
    with open(os.path.join(DATA, 'dup_answers.jsonl'), 'a', encoding='utf-8') as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        for r in recs:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')
        f.flush()
        os.fsync(f.fileno())
        fcntl.flock(f, fcntl.LOCK_UN)
    return self.send(200, {'ok': True, 'saved': recs})


H.decide = _decide


if __name__ == '__main__':
    print('photo-review listening on :8080', flush=True)
    ThreadingHTTPServer(('0.0.0.0', 8080), H).serve_forever()
