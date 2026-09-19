# Pi5 Homelab — /opt/stacks

Docker Compose definitions for a Raspberry Pi 5 running as a headless 24/7 home
server. This repo is the **source of truth** for how every service is configured.

> **Scope:** compose files and hand-authored config only.
> No application state, no media, no secrets, no network addresses.

---

## Rules

### 1. Every stateful path is a bind mount

**No named Docker volumes anywhere in this build.**

|  | Named volume | Bind mount |
|---|---|---|
| Location | `/var/lib/docker/volumes/<hash>/` | a path you chose, under `/srv` |
| Visible to `ls` | no | yes |
| Survives `docker compose down -v` | **no** | yes |
| Backup story | awkward | `rsync` |
| Lifecycle owned by | Docker | you |

An earlier build of this server kept Postgres on a named volume. A container
recreation destroyed it and took the photo library's metadata with it, leaving
nothing on disk to inspect afterward.

The rule is deliberately blunt. Its value is not per-volume correctness — it is
that `docker volume ls` returning **empty** is a one-second, judgment-free check
that the rule still holds. Carving out exceptions for "disposable" data would
trade that invariant for an argument every time.

### 2. Config lives here, state lives in /srv

> If this file were deleted, would I rewrite it by hand, or does the app
> regenerate it?
>
> **Rewrite by hand → this repo.   App regenerates → `/srv`.**

Some apps mix both in one directory — Homepage keeps hand-written YAML next to a
`logs/` tree it writes itself. Handled with a targeted ignore rule rather than by
splitting the mount. Inspect any new service's config directory before its first
commit.

### 3. Secrets never enter git

`.env` and `*.env` are ignored. Config references secrets by variable name;
values live only on the host. Git history is permanent — a committed secret is a
credential rotation, not a `.gitignore` fix.

---

## Layout

```
/opt/stacks/                 <- this repo
├── portainer/compose.yaml
├── homepage/compose.yaml
├── homepage/config/         <- tracked: settings, services, widgets, bookmarks,
│                                docker, kubernetes, proxmox, custom.css, custom.js
│   └── logs/                <- ignored: Homepage writes here
└── immich/compose.yaml
    └── .env                 <- ignored

/srv/                        <- runtime state, never in git
├── portainer/data/
└── immich/{library,postgres,db-backups}/
```

---

## Stack

| Service | Role | Access |
|---|---|---|
| Portainer CE | container inspection, browser | admin only |
| Homepage | status dashboard | admin only |
| Immich | family photo library | household + remote |

Outside Docker, on the host: **Tailscale** (access layer — no ports are forwarded
on the router) and **lazydocker** (terminal container inspection).

**Image tags are pinned to explicit versions, never `:latest`.** Git records what
changed in a file; only a pinned tag records what actually ran.

---

## Runbook

```
cd /opt/stacks/<service>

docker compose up -d                           # deploy / apply changes
docker compose up -d --force-recreate          # required when env vars changed
docker compose logs -f                         # follow logs
docker compose pull && docker compose up -d    # upgrade, after bumping the tag
```

**Inspectors inspect; they do not author.** Editing an env var in Portainer's UI
changes the *running container* only — git still says the old value, and the next
`docker compose up -d` silently reverts it. If a fix works when poked live, write
it into the compose file before you forget.

---

## Conventions

- **Commits auto-push.** A `post-commit` hook pushes to `origin` immediately.
- **Login prints a drift warning** if the working tree is dirty or has unpushed
  commits.
- One service per directory, named `compose.yaml`.

> ⚠️ The hook lives in `.git/hooks/`, which is **not** version controlled and will
> not survive a fresh clone onto new hardware. Re-create it after cloning.

---

## Full documentation

Architecture decisions, hardware validation, incident history and the build plan
live in a separate project document, not in this repo. Network addresses, hardware
identifiers and access details are deliberately kept out of version control.
