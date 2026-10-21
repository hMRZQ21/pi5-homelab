# Photo Review tests

## Unit tests (no browser, no server; Python 3 only)

    PYTHONDONTWRITEBYTECODE=1 python3 photo-review/tests/test_app.py -v

27 tests for the logic where a mistake costs the most: the path guard (`inside`: traversal, absolute paths, a sibling folder with
the same prefix, a symlink out), the keep-or-trash validation (`_decide`), the capped append (`append`, with parallel writers) and
the video Range parser. They use throwaway folders; the live data is never touched. The path-guard tests need Linux (the app uses
`/` paths) and are skipped on Windows. `APP_PATH=/path/to/app.py` points them at another copy: break a check on purpose in a copy
and the matching test must fail (rev 41: 8 deliberate breaks, 8 caught).

## Browser tests (manual)

Playwright scripts for the review pages. They were written against the data of 2026-10-11/13, so the counts inside
them (155 pair groups, 121 edit pairs, 21 live groups, ...) are a snapshot and need updating before a re-run.

| Script | Checks | What it covers |
|---|---|---|
| `t.js` | 55 | Pairs tab, tabs, save/reload, validation. Expects a `pairs.json` with the 155 original groups and no `pair_answers.jsonl` (the emptied-tab archive is `~/scan/dups/pairs_resolved_20261013.json` on the Pi). |
| `t2.js` | 16 | Event log: refused / failed save / JS error, `/api/event` validation. |
| `live.js`, `idx.js`, `empty.js`, `q2017.js` | render checks | Read-only checks of the LIVE page through a tunnel on port 2292. No saves. |

## Setup

    npm i playwright-core@1.56.1

The scripts launch Chromium from `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (the cloud container's copy);
change `executablePath` in each script on another machine.

## Throwaway instance (never test against live data)

Copy `/srv/photo-review/*.json*` to `/tmp/prtest/data` and `photo-review/app` to `/tmp/prtest/app` on the Pi, then:

    docker run -d --rm --name pr-test --user 1000:1000 -p 127.0.0.1:2291:8080 -e TZ=America/New_York \
      -v /tmp/prtest/app:/app:ro -v /tmp/prtest/data:/data \
      -v /srv/immich/library/thumbs:/thumbs:ro -v /srv/immich/library/encoded-video:/enc:ro \
      -v /srv/immich/library/library:/orig:ro python:3.13.16-alpine3.24 python -u /app/app.py

Reach it from another machine with an SSH tunnel (`ssh -f -N -L 2291:127.0.0.1:2291 pi5`); stop the tunnel by PID,
never with `pkill -f` and the command text. Remove `/tmp/prtest` when done (`/tmp` on the Pi is RAM).
