# Envo — notes for Claude Code

Self-hosted PBX: Asterisk 22 (PJSIP) + Node/TypeScript API + React dashboard. Read `README.md` first.

**Production is the office server `enfinitos1`** (`enfinito@103.129.209.29`, port 22, sudo user; key
`~/.ssh/envo_office_ed25519`). It sits behind the office MikroTik (RB760iGS) on LAN `192.168.20.237`;
the router owns public `103.129.209.29` and port-forwards only what is listed in README → "Office
server". It was provisioned by hand, not by `install.sh`: the app runs as PM2 process `envo` (user
`enfinito`) from `~/apps/envo` (env + secrets in `ecosystem.config.cjs`), nginx serves
`~/apps/envo/web`, and Asterisk was built from source. The old Hostinger VPS
(`root@72.60.104.105 -p 61022`) is only reachable with `ENVO_TARGET=vps`.

**The office server is shared** (Enbox, elyerp in Docker, MariaDB, MongoDB, coturn, nginx sites).
Never restart or reconfigure services Envo doesn't own (fail2ban's sshd jail included). Use
`NEEDRESTART_SUSPEND=1` and `--no-upgrade` for apt, always `nginx -t` before reloading, and prefer
`asterisk -rx 'core reload'` over restarting Asterisk.

## Working on it

```bash
cd server && npx tsc --noEmit      # typecheck (always before deploying)
cd web && npx tsc --noEmit -p .    # typecheck
deploy/deploy.sh                   # build + ship app to the office server (auto-rollback)
ENVO_TARGET=vps deploy/deploy.sh setup   # old VPS only: re-provision (idempotent)
```

`npm run build` in `web/` typechecks first, so a broken web change fails the build/deploy.

**Local development** (Docker Desktop must be running): `cd server && npm run dev` starts Postgres in
Docker (`envo-dev-pg`, port 54329) and rebuilds/restarts the server on change; `cd web && npm run dev`
serves the dashboard on http://localhost:5173 with `/api` proxied. Sign in as `admin@envo.local` /
`admin12345`. No Asterisk locally — AMI just retries, generated configs land in `.dev/`.

**Mobile layout:** every `table.table-base` turns into cards below `md` (CSS in `index.css`, cell
labels copied from the header by `lib/tableCards.ts`) — keep tables plain with a real `<thead>`.
`Modal` is a bottom sheet below `sm`; the phone tab bar (`Layout.tsx`) needs `pb-tabbar` space.

- The dashboard database is the source of truth. `server/src/asterisk/generator.ts` turns it into
  `/etc/asterisk/envo/*.conf`; `apply.ts` writes changed files and reloads only affected modules
  over AMI. Static dialplan logic lives in `server/src/asterisk/envo-lib.conf`.
- Anything user-supplied that reaches a config file must go through `asterisk/sanitize.ts`.
- Live state (registrations, channels, channel-limit groups) comes from AMI and is pushed to the
  browser over `/api/live`; per-tenant filtering is in `routes/live.ts`.
- Tenants are "SIP servers" in the UI: contexts `t<id>-*`, SIP usernames `<ext>_<slug>`, web phone
  endpoints `<ext>_<slug>_web`, channel-limit groups `envo_tenant/envo_trunk/envo_did`.
- Browser phones reach Asterisk through nginx, so they appear as 127.0.0.1 — endpoint ACLs keep
  desk-phone and web credentials on separate paths. Trunk hosts in 127.0.0.0/8 are rejected.
- `cdr_pgsql` reads the CDR table's columns only when it loads: after a CDR schema migration the
  module must be unloaded and loaded again (handled in `index.ts`).

## Gotchas found the hard way

- Asterisk answers an empty AMI list with `Response: Error` ("No Contacts found") — treated as empty.
- Docker's NAT masquerades traffic from its bridge subnets, which rewrites source IPs of local SIP
  tests; and PJSIP sends from its primary address, not the per-route source.
- fail2ban on Ubuntu defaults to the systemd journal; the Asterisk jail needs `backend = auto`.
- The IPTSP (123.0.31.250, iTelSwitch) delivers inbound calls **only to a registered line**: with the
  trunk in "Credentials only" mode outbound works but callers are cut off instantly and nothing
  reaches the server. The trunk must use "Register" (the provider grants ~60 s registrations).
- Behind the office NAT also keep UDP 5060 (from the provider) and RTP 10000-20000 port-forwarded,
  and MikroTik's SIP helper (`/ip firewall service-port sip`) disabled; Asterisk does its own NAT
  handling.
- When testing reachability with tcpdump on the server, never filter `not net 192.168.20.0/24`
  (forwarded packets are addressed to 192.168.20.237), and start sending only once tcpdump prints
  "listening" — SSH + sudo takes seconds. The user's home egress uses several public IPs.
- Asterisk's stock logrotate file (`make install-logrotate`) recreates logs as `root root`, which
  silently stops all Asterisk logging after the first rotation — it must say `asterisk asterisk`.
