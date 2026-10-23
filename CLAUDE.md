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

## Product model (accounts, packages, limits)

- A customer **account** owns SIP servers (tenants) and logins. Platform admins (`superadmin`) have no
  account; `admin` works across every server of its account; `agent` sits in one server;
  `users.is_owner` = billing/team. `SessionUser.tenantIds` is the access list — always check access
  with `canAccessTenant` / `tenantOf` / `assertTenantAccess`, never compare `user.tenantId`.
- Limits live in `packages` (+ per-customer `subscriptions.overrides`); `billing/plan.ts` resolves
  the effective plan (cached 10 s — call `invalidatePlans()` + `scheduleApply()` after changes) and
  `assertLimit` / `assertFeature` enforce them. NULL = unlimited, 0 = not included. Enfinito's own
  account is `internal` (never limited or billed).
- `asterisk/model.ts` applies plans to the config: servers of non-active accounts are disabled, recording
  forced off unless included, every server carries the account-wide channel cap (`envo_account/a<id>`).
- Multi-customer SIP safety: numbers are unique platform-wide and route only via their own trunk
  (`envo-did` keys `t<trunk>n<number>`); a provider IP used by several trunks is dropped from `match`
  and those trunks are identified by `match_request_uri` (their numbers); customer trunks get an
  endpoint ACL for their provider IPs and may not point at private networks. Config-sync status
  (warnings name other customers' trunks) goes to platform admins only.
- `billing/retention.ts` trims each account's recordings to its package (days, then MB) every 6 h.
- Billing: `billing/invoices.ts` (checkout, `markInvoicePaid` applies an invoice exactly once inside a
  transaction, SSLCommerz settle/reconcile, manual review), `billing/jobs.ts` (hourly clock),
  `billing/provision.ts` (first SIP server on first package). Gateway callbacks are public
  (`/api/public/sslcommerz/*`) and trust only the Validation API, never the posted fields. The
  browser returns by cross-site POST without the SameSite=Strict cookie, so the callback answers with
  a page that hops back same-site. Billing and SMTP settings live in their own `settings` rows and
  are never returned with passwords; `getSettings()` only returns known public keys.
- Enfinito Pay (`billing/enfinitoPay.ts`, pay.enfinito.com) takes online payments instead of
  SSLCommerz once its secret key and webhook secret are saved (Payments page). One open checkout per
  invoice (reused or cancelled before a new one, so nothing is paid twice). The signed webhook
  (`/api/public/enfinito-pay/webhook`) needs the raw body, so that router is mounted before
  `express.json`; the return link (`/return`) and the hourly clock ask for the checkout server to
  server. Wrong amounts and payments for paid/void invoices go to review, never applied. Test against
  a local stand-in by setting `ENFINITO_PAY_API`.
- Numbers from Enfinito (`routes/numberRequests.ts`, `supply/`): customers pick a free number from
  `number_pool` and send the operator's subscriber registration (details JSON + photo + NID under
  `<data dir>/kyc/<id>/`, 0600, served to platform admins only; dropped when a request is cancelled
  or rejected). Support works the queue at /admin/number-requests: register with the operator (ICC),
  then Connect (`connectLine()` from `routes/setup.ts`, the same code as the guided setup). Top-ups
  are `topup` invoices (paid like any invoice); a paid one waits in /admin until support adds the
  balance at the operator and marks it added. Any number connected through a request, or on a line
  to the operator's SIP server, can be topped up (`topupNumbers()`; Phone numbers, Billing → Calling
  balance, dashboard). On unless switched off in its Settings tab. The support
  steps are single functions on purpose: automation can replace them later. Envo never operates the
  operator's panels itself. A special (memorable) number is a request with `special` (the customer's
  words, no pool number); support checks it and bills any price by hand (Sales & invoices).
- Onboarding: before the first package, `PlanPicker` asks how many people and calls at the same time,
  recommends the package and keeps the answers in `accounts.onboarding`; `provisionFirstServer` then
  makes an extension per person (within the package, at most 50). `pages/GetStarted.tsx` is a
  one-question-per-step guide: number (`NumberChoice`: pool / own / special) → team
  (`POST /api/setup/team`: renames, new extensions, removes unused "Extension N" spares, logins and
  invites for emails, keeps "Everyone" in sync; all checks before any change) → where calls go
  (`/api/setup/routing` without `number_ids` also stores `tenants.default_dest_*`, which
  `defaultDestination()` uses for numbers connected later) → test. `useSetupProgress` is shared with
  the dashboard card and the menu.
- Customer menu (`lib/nav.ts`): the first group has no heading and holds the everyday pages; "Call
  handling" and "Settings" fold away (open on one of their pages; open state per browser).
  "Get started" sits at the top until the setup is done, then under Settings as "Setup guide".
- People and phones: a login calls from `users.extension_id` (web phone, voicemail, "my calls").
  `PUT /api/users/:id/extension` links one (or `{create:true}` makes the next free number), also for
  yourself; `POST /api/users` can `create_extension` and `invite` (7-day set-password link via
  `/reset?invite=1`, returned to the admin too). UI: `components/people.tsx`. After changing your own
  extension, refresh auth and invalidate `['webphone']`.
- Desk phones: `components/phoneSetup.tsx` (per-brand field guide, password dialog).
  `PUT /api/extensions/:id/password` takes `{style:'keypad'|'strong'}` or `{password}`; every SIP
  password goes through `sipPasswordProblem` (lib/secrets.ts). `settings.office_sip_host` is the LAN
  address for phones in Enfinito's office (shown to platform admins and internal servers only).
- Sign-up (`routes/signup.ts`): pending account + unverified owner; login requires
  `users.email_verified_at`; one-time links are stored as sha256 hashes. Anything an admin creates
  is verified. Emails go through `lib/mailer.ts` (logged in `email_log`; console only when SMTP is
  off). In development the confirmation link is printed in the server log.
- SSLCommerz sandbox for testing: store `testbox` / `qwerty`, card 4111111111111111 12/26 CVV 111,
  OTP page has a "Success" button.

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
