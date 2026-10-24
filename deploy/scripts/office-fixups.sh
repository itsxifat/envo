#!/usr/bin/env bash
# One-time fixes for the hand-provisioned office server (enfinitos1), bringing it in line with what
# install.sh does on the VPS. Idempotent - safe to run again. Touches only Envo/Asterisk files;
# fail2ban's existing sshd jail and every other service are left alone.
#
#   scp deploy/scripts/office-fixups.sh enfinito@103.129.209.29:/tmp/
#   ssh -t enfinito@103.129.209.29 'sudo bash /tmp/office-fixups.sh'
set -euo pipefail

APP_USER="${ENVO_APP_USER:-enfinito}"
PIPER_DIR="${ENVO_PIPER_DIR:-/var/lib/envo/piper}"
PIPER_VOICES="en_US-amy-medium en_US-ryan-medium en_GB-alba-medium en_GB-alan-medium"

LAN_IP="${ENVO_LAN_IP:-192.168.20.237}"
LAN_NET="${ENVO_LAN_NET:-192.168.20.0/24}"
PUBLIC_IP="${ENVO_PUBLIC_IP:-103.129.209.29}"

[ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }
log() { echo "[office-fixups] $*"; }
backup() { [ -e "$1" ] && [ ! -e "$1.envo-orig" ] && cp -a "$1" "$1.envo-orig" || true; }

# 0. Web phone audio. The VPS rtp.conf denies every private range for ICE, which on a VPS leaves the
#    public interface address. Here the only address is the LAN one, so Asterisk offered browsers no
#    ICE candidate at all ("ICE failed to create session check list") and web calls had no audio.
#    Advertise the router's public address (UDP 10000-20000 is forwarded 1:1) plus the LAN address.
backup /etc/asterisk/rtp.conf
cat > /etc/asterisk/rtp.conf <<EOF
; Envo - media ports (10000-20000/udp, port-forwarded 1:1 by the office router)
[general]
rtpstart = 10000
rtpend = 20000
strictrtp = yes
icesupport = yes
; Hide docker / VPN / loopback interfaces from ICE, but offer the office LAN address so browsers in
; the office reach Asterisk directly. (Asterisk ACLs: the last matching rule wins.)
ice_deny = 10.0.0.0/8
ice_deny = 172.16.0.0/12
ice_deny = 192.168.0.0/16
ice_deny = 100.64.0.0/10
ice_deny = 127.0.0.0/8
ice_permit = $LAN_NET

; Behind NAT: advertise the router's public address to browsers outside the office and keep the
; LAN address for browsers inside it.
[ice_host_candidates]
$LAN_IP => $PUBLIC_IP,include_local_address
EOF
chown root:asterisk /etc/asterisk/rtp.conf
chmod 0640 /etc/asterisk/rtp.conf
asterisk -rx 'module reload res_rtp_asterisk.so' >/dev/null
log "rtp.conf: ICE candidates $PUBLIC_IP + $LAN_IP (backup: rtp.conf.envo-orig)"

# 1. Asterisk logging. Asterisk's stock logrotate file recreates the logs as root:root, after which
#    Asterisk (user asterisk) cannot write them and logs nothing at all.
sed -i 's/^\(\s*create 640\) root root/\1 asterisk asterisk/' /etc/logrotate.d/asterisk
for f in full.log messages.log security.log queue_log; do
  if [ -e "/var/log/asterisk/$f" ]; then chown asterisk:asterisk "/var/log/asterisk/$f"; fi
done
asterisk -rx 'logger reload' >/dev/null
log "Asterisk logs: owned by asterisk, logrotate fixed"

# 2. Greetings and text-to-speech prompts: the app writes them, Asterisk plays them.
chown -R "$APP_USER:asterisk" /var/lib/asterisk/sounds/envo
find /var/lib/asterisk/sounds/envo -type d -exec chmod 2775 {} +
log "sounds: /var/lib/asterisk/sounds/envo writable by $APP_USER"

# 3. fail2ban jail for SIP password guessing (Asterisk security log). The sshd jail is untouched.
cat > /etc/fail2ban/jail.d/envo-asterisk.local <<'EOF'
# Envo: ban SIP scanners / password guessers reported by Asterisk's security log.
[asterisk]
enabled  = true
filter   = asterisk
# Ubuntu defaults jails to the systemd journal; Asterisk writes security events to a file.
backend  = auto
port     = 5060,5061
action   = %(banaction)s[name=%(__name__)s-tcp, port="%(port)s", protocol="tcp"]
           %(banaction)s[name=%(__name__)s-udp, port="%(port)s", protocol="udp"]
logpath  = /var/log/asterisk/security.log
maxretry = 8
findtime = 600
bantime  = 3600
# localhost (browser phones arrive through nginx), the office LAN and the IPTSP trunk
ignoreip = 127.0.0.1/8 ::1 192.168.20.0/24 123.0.31.250
EOF
chmod 0644 /etc/fail2ban/jail.d/envo-asterisk.local
fail2ban-client -t >/dev/null
fail2ban-client reload >/dev/null   # keeps existing bans
log "fail2ban: $(fail2ban-client status | sed -n 's/.*Jail list:\s*//p')"

# 4. Nightly database backup, 14 days kept.
install -d -o postgres -g postgres -m 0700 /var/backups/envo
cat > /etc/cron.d/envo-backup <<'EOF'
# Envo: nightly database backup, 14 days kept (restore: pg_restore -c -d envo <file>)
SHELL=/bin/sh
30 3 * * * postgres pg_dump -Fc envo > /var/backups/envo/envo-$(date +\%F).dump && find /var/backups/envo -name 'envo-*.dump' -mtime +14 -delete
EOF
chmod 0644 /etc/cron.d/envo-backup
log "backups: nightly pg_dump to /var/backups/envo"

# 5. Piper text-to-speech (same release and voices as install.sh), owned by the app user.
install -d -o "$APP_USER" -g "$APP_USER" "$PIPER_DIR" "$PIPER_DIR/voices"
if [ ! -x "$PIPER_DIR/piper" ]; then
  tmp="$(mktemp -d)"
  curl -fsSL "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz" -o "$tmp/piper.tgz"
  tar -xzf "$tmp/piper.tgz" -C "$tmp"
  cp -a "$tmp/piper/." "$PIPER_DIR/"
  rm -rf "$tmp"
fi
for v in $PIPER_VOICES; do
  [ -s "$PIPER_DIR/voices/$v.onnx" ] && continue
  lang="${v%%-*}"; family="${lang%%_*}"; rest="${v#*-}"; speaker="${rest%-*}"; quality="${rest##*-}"
  base="https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/$family/$lang/$speaker/$quality/$v"
  log "downloading voice $v"
  curl -fsSL "$base.onnx.json" -o "$PIPER_DIR/voices/$v.onnx.json"
  curl -fsSL "$base.onnx" -o "$PIPER_DIR/voices/$v.onnx.part" && mv "$PIPER_DIR/voices/$v.onnx.part" "$PIPER_DIR/voices/$v.onnx"
done
chown -R "$APP_USER:$APP_USER" "$PIPER_DIR"
chmod -R a+rX "$PIPER_DIR"
log "piper: $(ls "$PIPER_DIR/voices" | grep -c '\.onnx$') voices in $PIPER_DIR"

# 6. Sound uploads: nginx defaults to a 1 MB request body ("413 Request Entity Too Large"); the app
#    accepts files up to 25 MB.
NGINX_SITE=/etc/nginx/sites-available/envo.conf
if ! grep -q client_max_body_size "$NGINX_SITE"; then
  backup "$NGINX_SITE"
  sed -i 's|^\(\s*\)index index.html;|&\n\1client_max_body_size 30m;   # sound uploads (app limit 25 MB)|' "$NGINX_SITE"
  nginx -t && systemctl reload nginx
fi
log "nginx: $(grep -o 'client_max_body_size [^;]*' "$NGINX_SITE")"

# 7. Live selfie on the website (Envo Phone sign-up): a Permissions-Policy of camera=() blocks the
#    camera in every browser. Allow it for Envo's own pages, wherever the header is set.
HEADERS=/etc/nginx/snippets/envo-headers.conf
camera_fixed=""
for f in "$NGINX_SITE" "$HEADERS"; do
  [ -f "$f" ] && grep -q 'camera=()' "$f" || continue
  backup "$f"
  sed -i 's/camera=()/camera=(self)/' "$f"
  camera_fixed=1
done
if [ -n "$camera_fixed" ]; then nginx -t && systemctl reload nginx; fi
log "nginx: $(cat "$NGINX_SITE" "$HEADERS" 2>/dev/null | grep -o 'camera=([^)]*)' | sort -u | tr '\n' ' ' || true)"

# 8. envo.enfinito.cloud is proxied through Cloudflare, so every visitor seemed to come from a
#    Cloudflare address and per-address limits (sign-ups, sign-ins) hit many people at once. Take the
#    visitor's address from CF-Connecting-IP, only on connections that come from Cloudflare.
CF_SNIPPET=/etc/nginx/snippets/envo-cloudflare.conf
cf_ranges=$( { curl -fsS --max-time 20 https://www.cloudflare.com/ips-v4 && echo && curl -fsS --max-time 20 https://www.cloudflare.com/ips-v6; } 2>/dev/null | tr -s ' \r\n' '\n' | sed '/^$/d' || true)
if [ "$(echo "$cf_ranges" | grep -c .)" -ge 10 ] && ! echo "$cf_ranges" | grep -qvE '^[0-9a-f.:]+/[0-9]{1,3}$'; then
  had_snippet=""; [ -f "$CF_SNIPPET" ] && had_snippet=1 && cp -a "$CF_SNIPPET" "$CF_SNIPPET.prev"
  { echo "# Cloudflare's addresses (office-fixups.sh): visitors' own addresses come from CF-Connecting-IP."
    echo "$cf_ranges" | sed 's/.*/set_real_ip_from &;/'
    echo "real_ip_header CF-Connecting-IP;"; } > "$CF_SNIPPET"
  site_changed=""
  if ! grep -q envo-cloudflare.conf "$NGINX_SITE"; then
    backup "$NGINX_SITE"
    cp -a "$NGINX_SITE" "$NGINX_SITE.prev"
    sed -i "s|^\(\s*\)index index.html;|&\n\1include $CF_SNIPPET;   # visitors' addresses behind Cloudflare|" "$NGINX_SITE"
    site_changed=1
  fi
  if nginx -t 2>/dev/null; then
    systemctl reload nginx
    log "nginx: $(grep -c set_real_ip_from "$CF_SNIPPET") Cloudflare ranges, visitors' addresses from CF-Connecting-IP"
  else
    # Leave nginx exactly as it was.
    [ -n "$site_changed" ] && mv "$NGINX_SITE.prev" "$NGINX_SITE"
    if [ -n "$had_snippet" ]; then mv "$CF_SNIPPET.prev" "$CF_SNIPPET"; else rm -f "$CF_SNIPPET"; fi
    log "nginx: the Cloudflare address setting did not pass nginx -t, left out"
  fi
  rm -f "$NGINX_SITE.prev" "$CF_SNIPPET.prev"
else
  log "nginx: could not get Cloudflare's address list, visitors' addresses left as before"
fi

log "done"
