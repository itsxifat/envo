# Envo — Cloud PBX platform

Envo is a self-hosted phone system: an Asterisk 22 SIP server plus a web dashboard that controls
all of it. You create **SIP servers** (isolated virtual PBXs), add extensions for IP phones and
softphones, connect SIP trunks from your provider, attach phone numbers (DIDs), build IVRs, ring
groups, queues, conference rooms and time-based routing — and make or take calls straight from the
browser with the built-in WebRTC phone.

- Dashboard: <https://envo.enfinito.cloud> (also reachable at `call.enfinito.cloud` and the old
  `srv1245572.hstgr.cloud`)
- SIP server for phones and trunks: `call.enfinito.cloud` (UDP/TCP 5060, TLS 5061, RTP 10000-20000)
- Admin credentials: see `/etc/envo/envo.env` on the server (`ENVO_ADMIN_EMAIL`, `ENVO_ADMIN_PASSWORD`)

`envo.enfinito.cloud` is proxied through Cloudflare (dashboard traffic only). `call.enfinito.cloud`
is a DNS-only A record straight to the server, because SIP and RTP cannot pass through a Cloudflare
proxy — so the browser phone deliberately opens its SIP WebSocket on `wss://call.enfinito.cloud/ws`
while the dashboard itself is served through the CDN. One Let's Encrypt certificate (lineage `envo`)
covers all three names and is used by nginx *and* Asterisk's SIP TLS transport.

## How it fits together

```
  Browser (dashboard + WebRTC phone)            IP phones / softphones        SIP provider (IPTSP)
                 │ HTTPS + WSS                      │ SIP 5060/5061                  │ SIP
                 ▼                                  ▼                                ▼
            ┌──────────┐   /api      ┌───────────────────────────────────────────────────┐
            │  nginx   │────────────▶│  Envo server (Node)  ──AMI──▶  Asterisk 22 (PJSIP)│
            │  TLS     │   /ws ─────▶│  writes /etc/asterisk/envo/*.conf, hot-reloads    │
            └──────────┘             └───────────────┬───────────────────────────────────┘
                                                     │
                                         PostgreSQL "envo" (config + CDR)
```

The dashboard database is the single source of truth. On every change Envo regenerates the Asterisk
configuration into `/etc/asterisk/envo/` and reloads only the affected modules over AMI, so changes
take effect in under a second without dropping calls. Asterisk writes call records straight into
PostgreSQL with an append-only database role.

## What you can do

| Area | Features |
|---|---|
| SIP servers | Multiple isolated PBXs (own extensions, numbers, routing, channel limit), quick-create with a block of extensions |
| Extensions | SIP accounts for desk phones/softphones, companion WebRTC phone, bulk creation, per-extension codecs, caller ID, ring time, recording policy, DND and call forwarding, voicemail |
| Trunks | Registration, credentials-only or IP-authenticated providers; UDP/TCP/TLS; channel limits; per-trunk codecs, DTMF mode, PAI, outbound proxy, extra provider IPs |
| Numbers (DIDs) | Route to extension, ring group, queue, IVR, time condition, conference, voicemail or an external number; channel limit per number; caller-ID prefix; per-number recording. National/international forms are matched automatically |
| Call routing | IVR menus (keypad options, direct dial, timeout/invalid handling), ring groups (ring-all or hunt), queues (6 strategies, wrap-up, position announcements), time conditions with holidays and force-open/closed, outbound routes with dial patterns, digit manipulation and trunk failover |
| Extras | Conference rooms with PIN, blocked callers (exact/prefix/anonymous), text-to-speech greetings (local neural TTS), call recording with in-browser playback, voicemail with playback, live call monitor with hang-up, call logs with recordings, audit log |
| Web phone | Register-free browser phone per user: dial pad, contacts with live presence, recent calls, mute, hold (music on hold), DTMF, blind transfer, incoming-call notifications |

### Feature codes (dial from any phone)

| Code | Action |
|---|---|
| `*43` | Echo test (audio check) |
| `*97` | Your voicemail |
| `*98` | Voicemail for another mailbox |
| `*65` | Speak your extension number |
| `*60` | Speak the current time |
| `*78` / `*79` | Do-not-disturb on / off |
| `*72<number>` / `*73` | Forward all calls on / off |
| `*8` | Pick up a ringing colleague's call |
| `##` / `*2` | Blind / attended transfer during a call |

## Selling Envo (accounts, packages, billing)

Envo is sold as monthly packages. The public website at `/` shows the pricing (generated from the
packages), and customers sign up, confirm their email, answer two questions (how many people use
phones, how many calls at the same time) that point to the package that fits, and pay — then a SIP
server with an extension for each person is created and the owner's web phone works right away.
**Get started** then takes them through the rest one question at a time: their number (one from
Enfinito, their own, or a special one), their team (names; an email gives a login and an invitation),
where calls go, and a test call.

| Who | Where | What |
|---|---|---|
| Visitors | `/`, `/signup` | Landing page with live pricing, sign-up, email confirmation, password reset |
| Customers (owner) | Billing, Plan & usage | Choose / renew / upgrade (prorated) / switch at renewal, pay online or report a bKash/bank transfer, invoices, billing details |
| Customers (admins) | Everything PBX | Their account's SIP servers, extensions, numbers, trunks, team — within the package |
| Customers (admins), support | Phone numbers → Add a number; Billing & top-ups → Calling balance; /admin → Number requests | Customers choose a number from a provider's allocation (the prefix, e.g. 09639 for ICC, is fixed; or apply for a special number) and send the registration (NID, photo); support registers it, connects it in one step, and adds paid top-ups. Providers (name, prefix, SIP server) are kept under Number requests → Settings |
| Enfinito (platform admins) | Business → Customers, Sales, Packages, Email | Customers (suspend, close, package, custom limits, open their PBX), revenue and invoices, payments to confirm, package editor, payment and email settings |

- **Packages** limit SIP servers, IP numbers, extensions, concurrent calls (account-wide), IVR menus,
  recording days and storage, and switch call monitoring / developer API on or off. Enfinito's own
  account is internal and unlimited.
- **The customer menu** shows the everyday pages first (calls, voicemail, numbers, team, billing);
  call handling (IVR menus, ring groups, queues, business hours…) and settings are folded away at the
  bottom and open by themselves on one of their pages.
- **Billing** runs by itself every hour: renewal invoices 7 days before a period ends, past due at
  the end, suspension after a 3-day grace (both adjustable), and a "payment received" email on
  every payment. A suspended account keeps its data; its phones stop until it pays.
- **Payments**: SSLCommerz (bKash, Nagad, Rocket, cards, internet banking), each confirmed with
  SSLCommerz's validation API; manual bKash/bank transfers are confirmed by an admin in Sales.

### Before selling for real

1. **Payment settings** (Payments in /admin): the Enfinito Pay secret key and webhook signing
   secret (`sk_test_…` first, then `sk_live_…`), and in the Enfinito Pay admin the webhook URL and
   return domain shown there. Or, without Enfinito Pay, your live SSLCommerz store ID and password,
   sandbox off (test with the sandbox store `testbox`: card 4111 1111 1111 1111, 12/26, 111).
2. **Email** (Business → Email): an SMTP mailbox (e.g. mailcow on the old VPS, or Brevo). Without
   it new customers cannot confirm their email (you can confirm them by hand on the customer page).
3. **Packages**: check prices and limits in Business → Packages.
4. **Router**: customers bring trunks from many providers and phones from anywhere, so UDP 5060 must
   be forwarded from everywhere (not only 123.0.31.250), plus TCP 5061 for TLS phones — and the SIP
   fail2ban jail from `deploy/scripts/office-fixups.sh` must be on first.

## Connecting things

**An IP phone or softphone** — Extensions → key icon on the extension → pick the phone (Yealink,
Grandstream, Fanvil, Cisco/Linksys SPA, Zoiper, MicroSIP, Linphone or "other"): the guide lists
each field in that phone's own words and what goes in it. Easiest is the phone's own web page (its IP
address is in the phone's Status menu). "Change password" sets a 10-digit keypad-friendly password,
a long one, or your own (weak ones are refused); the SIP username can be shortened in the extension's
settings. Phones inside the office use the server's LAN address — set it once in *System → Network
→ Office address for desk phones* (192.168.20.237) and the guide offers "In the office / Anywhere
else". Then dial `*43` to check audio. TLS + SRTP works on port 5061.

**Your provider's SIP trunk / IP phone number**
1. SIP trunks → Add trunk: server host, port, and either *Register* (username + password — the usual
   IPTSP case) or *IP based* if the provider whitelists this server's IP (103.129.209.29). Set
   *Channels* to what you bought.
2. Phone numbers → Add number: the number as the provider sends it, its trunk, and where it should
   ring (e.g. an IVR or ring group).
3. Outbound routes → Add route: dial patterns (`01[3-9]XXXXXXXX` for BD mobiles), the trunk, and an
   optional caller ID. Presets for Bangladesh formats are one click.
4. The trunk shows **Registered** on the dashboard when the provider accepts it.

**Changing hostnames** — point A records at 103.129.209.29 (keep the SIP name DNS-only). On the
office server, add the name to the nginx site and the certbot certificate and update `PUBLIC_HOST` /
`SIP_DOMAIN` in `~/apps/envo/ecosystem.config.cjs`. (On the old VPS,
`ENVO_TARGET=vps ENVO_DOMAIN=… ENVO_SIP_DOMAIN=… deploy/deploy.sh setup` does all of that.) The SIP
domain shown to phones comes from *System → Network & numbering* (`sip_domain`), which defaults to
`SIP_DOMAIN`.

## Office server

Production runs on `enfinitos1`, an Ubuntu box in the office behind a MikroTik RB760iGS. The router
holds the public address 103.129.209.29 (second line 103.18.205.246 is backup only) and the server is
`192.168.20.237` (fixed DHCP lease). Everything the outside world reaches is a router port-forward:

| Forward (dst-nat to 192.168.20.237) | Why |
|---|---|
| TCP 80, 443 | dashboard, web phone WebSocket |
| UDP 5060 **from 123.0.31.250 only** | inbound calls from the IPTSP trunk |
| UDP 10000-20000 | call audio (RTP), Asterisk's `rtpstart`/`rtpend` |
| TCP 22 from `ssh-allowed` | SSH |

The router's SIP helper (`/ip firewall service-port sip`) must stay **disabled** — Asterisk already
rewrites its own addresses (`external_*_address` on the transports). Office phones register to
`192.168.20.237` directly; phones outside the office would additionally need UDP/TCP 5060 and TCP
5061 forwarded from anywhere, with the Asterisk fail2ban jail in place first. If the backup line
takes over, SIP to the provider fails until the main line is back (the provider knows only
103.129.209.29).

The IPTSP trunk **must be in "Register" mode**: the provider only delivers inbound calls to a
registered line. In "Credentials only" mode outbound calls still work, but callers are cut off
instantly and nothing reaches the server. Without the 5060 forward, inbound calls can also die at
the router.

Because Asterisk only has a LAN address, `rtp.conf` maps it to the public one for ICE
(`[ice_host_candidates] 192.168.20.237 => 103.129.209.29,include_local_address`) — without that the
browser phone connects calls but has no audio. That and the other bits `install.sh` would have done
(log ownership, sounds dir permissions, SIP fail2ban jail, nightly backups, Piper TTS) are in
`deploy/scripts/office-fixups.sh` (idempotent; run with sudo on the server).

## Repository layout

```
server/        API, Asterisk config generator, AMI client, live state (TypeScript, bundled with esbuild)
  src/asterisk/  generator.ts (DB → pjsip/dialplan/voicemail/queues), envo-lib.conf (static dialplan), ami.ts, apply.ts, live.ts
  migrations/    SQL migrations, applied on start
web/           React + Vite dashboard and WebRTC phone (JsSIP)
deploy/        install.sh (provisioning), deploy.sh (build + ship), Asterisk/nginx/systemd/fail2ban config
```

## Day-to-day operations

```bash
deploy/deploy.sh                 # build locally, ship to the office server, health-check (auto-rollback)
ssh -i ~/.ssh/envo_office_ed25519 enfinito@103.129.209.29

pm2 ls; pm2 logs envo            # dashboard/API process and log
systemctl status asterisk        # Asterisk
tail -f /var/log/asterisk/messages.log
asterisk -rvvv                   # Asterisk console
asterisk -rx 'pjsip show contacts'   # registered phones
```

- Generated Asterisk config: `/etc/asterisk/envo/` (never edit by hand — it is rewritten on change)
- Recordings: `/var/spool/asterisk/monitor/envo/<server>/<date>/`
- Voicemail: `/var/spool/asterisk/voicemail/t<server id>/<extension>/`
- Greetings/prompts: `/var/lib/asterisk/sounds/envo/`
- Database backup: nightly `pg_dump` to `/var/backups/envo/` (14 days). Restore:
  `pg_restore -c -d envo /var/backups/envo/envo-YYYY-MM-DD.dump`
- Releases: `~/apps/envo/releases/<version>` (last 5 kept, plus `initial` — the hand-installed
  build); the live copy is `~/apps/envo/server` + `web`, its version in `~/apps/envo/VERSION`. To roll
  back, copy a release's `server/` and `web/` over the live ones and `pm2 restart envo`.

## Security

- AMI, ARI and the Node API listen on localhost only; the dashboard is reachable through nginx over
  HTTPS with a Let's Encrypt certificate (auto-renewed, hook also refreshes Asterisk's SIP TLS cert).
- Sessions are httpOnly/secure/sameSite-strict cookies; passwords are bcrypt; logins are rate limited.
- Desk-phone endpoints reject requests from the WebSocket proxy, and browser-phone endpoints only
  accept it, so web credentials can't be replayed over plain SIP and vice versa.
- fail2ban watches Asterisk's security log and bans SIP scanners (8 failures → 1 hour) on 5060/5061.
- Every generated config value is sanitized; dial patterns, numbers, hosts and IPs are validated
  server-side, so no dashboard field can inject dialplan.
- Extension passwords are random 20-character strings; the browser phone uses a separate derived
  secret that is never stored.
- Outbound calling can be disabled per extension, and channel limits cap concurrent calls per
  SIP server, per trunk and per number (toll-fraud damage control).

## Possible next steps

- G.729 codec module, if a provider insists on it (patents expired; `bcg729` builds against Asterisk)
- coturn TURN server for callers on networks that block UDP entirely
- Voicemail-to-email (needs an SMTP relay; mailcow on this host can serve as one)
- AI voice agent / live transcription — Asterisk is built with AudioSocket and `chan_websocket`
- Phone auto-provisioning (Asterisk's `pjsip_notify.conf` is installed for reboot/re-provision)
