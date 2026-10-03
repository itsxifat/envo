#!/usr/bin/env bash
# Envo installer / updater. Runs as root on the server from an extracted release bundle:
#   bash envo/deploy/scripts/install.sh setup     # first install (idempotent, safe to re-run)
#   bash envo/deploy/scripts/install.sh release   # deploy a new version of the app only
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1 NEEDRESTART_MODE=l

MODE="${1:-release}"
BUNDLE="$(cd "$(dirname "$0")/../.." && pwd)"
# Dashboard hostname, the SIP hostname phones use, and any extra names to keep serving.
DOMAIN="${ENVO_DOMAIN:-envo.enfinito.cloud}"
SIP_DOMAIN="${ENVO_SIP_DOMAIN:-call.enfinito.cloud}"
EXTRA_DOMAINS="${ENVO_EXTRA_DOMAINS:-srv1245572.hstgr.cloud}"
CERT_NAME="${ENVO_CERT_NAME:-envo}"
PUBLIC_IP="${ENVO_PUBLIC_IP:-72.60.104.105}"
ADMIN_EMAIL="${ENVO_ADMIN_EMAIL:-admin@envo.local}"
NODE_VERSION="v24.21.0"
VERSION="$(cat "$BUNDLE/VERSION")"
ENV_FILE=/etc/envo/envo.env
ASTERISK_SRC="$(ls -d /usr/src/envo/asterisk-22.*/ 2>/dev/null | head -1)"

log() { echo "[envo] $*"; }
rand() { openssl rand -hex "${1:-24}"; }

# All hostnames this server answers to, deduplicated, dashboard name first.
all_domains() {
  printf '%s\n' "$DOMAIN" "$SIP_DOMAIN" $EXTRA_DOMAINS | awk 'NF && !seen[$0]++'
}

ensure_users() {
  id asterisk >/dev/null 2>&1 || useradd --system --home-dir /var/lib/asterisk --shell /usr/sbin/nologin --user-group asterisk
  id envo >/dev/null 2>&1 || useradd --system --home-dir /var/lib/envo --shell /usr/sbin/nologin --user-group envo
  usermod -aG asterisk envo
}

ensure_secrets() {
  install -d -m 0755 /etc/envo
  if [ ! -f "$ENV_FILE" ]; then
    log "generating secrets in $ENV_FILE"
    local admin_pass
    admin_pass="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 16)"
    cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=4310
HOST=127.0.0.1
PUBLIC_HOST=$DOMAIN
SIP_DOMAIN=$SIP_DOMAIN
PUBLIC_IP=$PUBLIC_IP
DB_PASSWORD=$(rand 18)
CDR_DB_PASSWORD=$(rand 18)
DATABASE_URL=postgres://envo:__DB_PASSWORD__@127.0.0.1:5432/envo
JWT_SECRET=$(rand 32)
AMI_USER=envo
AMI_SECRET=$(rand 18)
ARI_SECRET=$(rand 18)
ENVO_ADMIN_EMAIL=$ADMIN_EMAIL
ENVO_ADMIN_PASSWORD=$admin_pass
ENVO_VERSION=$VERSION
EOF
    local dbp
    dbp="$(grep '^DB_PASSWORD=' "$ENV_FILE" | cut -d= -f2)"
    sed -i "s|__DB_PASSWORD__|$dbp|" "$ENV_FILE"
  fi
  # Hostnames come from the install parameters, so keep them in step on every run.
  local key value
  for key in PUBLIC_HOST SIP_DOMAIN PUBLIC_IP; do
    case "$key" in
      PUBLIC_HOST) value="$DOMAIN" ;;
      SIP_DOMAIN) value="$SIP_DOMAIN" ;;
      PUBLIC_IP) value="$PUBLIC_IP" ;;
    esac
    if grep -q "^$key=" "$ENV_FILE"; then
      sed -i "s|^$key=.*|$key=$value|" "$ENV_FILE"
    else
      echo "$key=$value" >> "$ENV_FILE"
    fi
  done
  chown root:envo "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
}

load_env() {
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
}

ensure_dirs() {
  install -d -o asterisk -g asterisk -m 0755 /var/lib/asterisk /var/spool/asterisk /var/log/asterisk /var/cache/asterisk
  # Everything Asterisk owns, except the sound folder Envo manages.
  find /var/lib/asterisk /var/spool/asterisk /var/log/asterisk /var/cache/asterisk \
    -path /var/lib/asterisk/sounds/envo -prune -o -exec chown asterisk:asterisk {} +
  install -d -o asterisk -g asterisk -m 2775 /var/spool/asterisk/voicemail /var/spool/asterisk/monitor /var/spool/asterisk/monitor/envo
  install -d -o root -g asterisk -m 0750 /etc/asterisk /etc/asterisk/keys
  install -d -o envo -g asterisk -m 2750 /etc/asterisk/envo
  install -d -o envo -g asterisk -m 2775 /var/lib/asterisk/sounds/envo
  chown -R envo:asterisk /var/lib/asterisk/sounds/envo
  install -d -o envo -g envo -m 0750 /var/lib/envo /var/lib/envo/uploads
  install -d -m 0755 /opt/envo /opt/envo/releases
  # Asterisk includes these; Envo fills them on start.
  for f in pjsip_envo.conf extensions_envo.conf extensions_envo_lib.conf voicemail_envo.conf queues_envo.conf; do
    [ -f "/etc/asterisk/envo/$f" ] || install -o envo -g asterisk -m 0640 /dev/null "/etc/asterisk/envo/$f"
  done
}

write_asterisk_config() {
  log "writing Asterisk base configuration"
  for f in "$BUNDLE"/deploy/asterisk/*.conf; do
    sed -e "s|__PUBLIC_IP__|$PUBLIC_IP|g" \
        -e "s|__SIP_DOMAIN__|$SIP_DOMAIN|g" \
        -e "s|__AMI_SECRET__|$AMI_SECRET|g" \
        -e "s|__ARI_SECRET__|$ARI_SECRET|g" \
        -e "s|__CDR_PASSWORD__|$CDR_DB_PASSWORD|g" \
        "$f" > "/etc/asterisk/$(basename "$f")"
  done
  # Optional modules log an error when their config file is missing; defaults are fine.
  for f in acl.conf udptl.conf codecs.conf pjproject.conf websocket_client.conf chan_websocket.conf \
           cli_aliases.conf res_http_media_cache.conf ccss.conf; do
    [ -f "/etc/asterisk/$f" ] || printf '; Envo: defaults are used\n' > "/etc/asterisk/$f"
  done
  # Stock tone tables and phone NOTIFY (reboot/re-provision) definitions from the Asterisk source.
  for f in indications.conf pjsip_notify.conf; do
    if [ -n "$ASTERISK_SRC" ] && [ ! -f "/etc/asterisk/$f" ]; then
      cp "$ASTERISK_SRC/configs/samples/$f.sample" "/etc/asterisk/$f"
    fi
  done
  if [ ! -s /etc/asterisk/keys/envo.crt ]; then
    openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=$DOMAIN" \
      -keyout /etc/asterisk/keys/envo.key -out /etc/asterisk/keys/envo.crt >/dev/null 2>&1
  fi
  chown root:asterisk /etc/asterisk/*.conf /etc/asterisk/keys/*
  chmod 0640 /etc/asterisk/*.conf /etc/asterisk/keys/*
}

ensure_database() {
  log "preparing PostgreSQL database"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'envo') THEN
    CREATE ROLE envo LOGIN PASSWORD '$DB_PASSWORD';
  ELSE
    ALTER ROLE envo LOGIN PASSWORD '$DB_PASSWORD';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'envo_cdr') THEN
    CREATE ROLE envo_cdr LOGIN PASSWORD '$CDR_DB_PASSWORD';
  ELSE
    ALTER ROLE envo_cdr LOGIN PASSWORD '$CDR_DB_PASSWORD';
  END IF;
END
\$\$;
ALTER ROLE envo_cdr SET timezone = 'UTC';
SQL
  if ! sudo -u postgres psql -Atqc "SELECT 1 FROM pg_database WHERE datname = 'envo'" | grep -q 1; then
    sudo -u postgres createdb -O envo -E UTF8 envo
  fi
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d envo <<SQL
REVOKE CONNECT ON DATABASE envo FROM PUBLIC;
GRANT CONNECT ON DATABASE envo TO envo, envo_cdr;
DO \$\$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'cdr') THEN
    GRANT INSERT, SELECT ON cdr TO envo_cdr;
    GRANT USAGE ON SEQUENCE cdr_id_seq TO envo_cdr;
  END IF;
END
\$\$;
SQL
}

ensure_node() {
  if [ -x /opt/envo/node/bin/node ] && [ "$(/opt/envo/node/bin/node -v)" = "$NODE_VERSION" ]; then return; fi
  log "installing Node.js $NODE_VERSION for Envo (private copy, system node untouched)"
  local tmp
  tmp="$(mktemp -d)"
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.xz" -o "$tmp/node.tar.xz"
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  (cd "$tmp" && grep " node-$NODE_VERSION-linux-x64.tar.xz\$" SHASUMS256.txt | sed "s|node-$NODE_VERSION-linux-x64.tar.xz|node.tar.xz|" | sha256sum -c -)
  rm -rf /opt/envo/node.new
  mkdir -p /opt/envo/node.new
  tar -xJf "$tmp/node.tar.xz" -C /opt/envo/node.new --strip-components=1
  rm -rf /opt/envo/node
  mv /opt/envo/node.new /opt/envo/node
  rm -rf "$tmp"
}

PIPER_VOICES="en_US-amy-medium en_US-ryan-medium en_GB-alba-medium en_GB-alan-medium"

ensure_piper() {
  local dir=/opt/envo/piper
  if [ ! -x "$dir/piper" ]; then
    log "installing Piper text-to-speech"
    local tmp
    tmp="$(mktemp -d)"
    curl -fsSL "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz" -o "$tmp/piper.tgz"
    tar -xzf "$tmp/piper.tgz" -C "$tmp"
    install -d "$dir"
    cp -a "$tmp/piper/." "$dir/"
    rm -rf "$tmp"
  fi
  install -d "$dir/voices"
  local v lang family rest speaker quality base
  for v in $PIPER_VOICES; do
    [ -s "$dir/voices/$v.onnx" ] && continue
    lang="${v%%-*}"; family="${lang%%_*}"; rest="${v#*-}"; speaker="${rest%-*}"; quality="${rest##*-}"
    base="https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/$family/$lang/$speaker/$quality/$v"
    log "downloading voice $v"
    curl -fsSL "$base.onnx.json" -o "$dir/voices/$v.onnx.json"
    curl -fsSL "$base.onnx" -o "$dir/voices/$v.onnx.part" && mv "$dir/voices/$v.onnx.part" "$dir/voices/$v.onnx"
  done
  chmod -R a+rX "$dir"
}

ensure_backups() {
  install -d -o postgres -g postgres -m 0700 /var/backups/envo
  cat > /etc/cron.d/envo-backup <<'EOF'
# Envo: nightly database backup, 14 days kept (restore: pg_restore -d envo <file>)
SHELL=/bin/sh
30 3 * * * postgres pg_dump -Fc envo > /var/backups/envo/envo-$(date +\%F).dump && find /var/backups/envo -name 'envo-*.dump' -mtime +14 -delete
EOF
  chmod 0644 /etc/cron.d/envo-backup
}

install_units() {
  install -m 0644 "$BUNDLE/deploy/systemd/asterisk.service" /etc/systemd/system/asterisk.service
  install -m 0644 "$BUNDLE/deploy/systemd/envo.service" /etc/systemd/system/envo.service
  install -m 0644 "$BUNDLE/deploy/logrotate/asterisk" /etc/logrotate.d/asterisk
  systemctl daemon-reload
  systemctl enable asterisk.service envo.service >/dev/null 2>&1
}

ensure_firewall() {
  if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
    log "opening SIP and RTP ports in ufw"
    ufw allow 5060/udp comment 'Envo SIP' >/dev/null
    ufw allow 5060/tcp comment 'Envo SIP' >/dev/null
    ufw allow 5061/tcp comment 'Envo SIP TLS' >/dev/null
    ufw allow 10000:20000/udp comment 'Envo RTP media' >/dev/null
  fi
}

ensure_fail2ban() {
  sed "s|__PUBLIC_IP__|$PUBLIC_IP|g" "$BUNDLE/deploy/fail2ban/envo.local" > /etc/fail2ban/jail.d/envo.local
  touch /var/log/asterisk/security.log
  chown asterisk:asterisk /var/log/asterisk/security.log
  systemctl enable fail2ban >/dev/null 2>&1
  systemctl restart fail2ban
}

write_nginx_site() {
  # $1 = certificate directory to reference
  local names
  names="$(all_domains | tr '\n' ' ' | sed 's/ $//')"
  sed -e "s|__SERVER_NAMES__|$names|g" -e "s|__CERT_DIR__|$1|g" "$BUNDLE/deploy/nginx/envo.conf" > /etc/nginx/sites-available/envo
  ln -sf /etc/nginx/sites-available/envo /etc/nginx/sites-enabled/envo
  nginx -t -q
  systemctl reload nginx
}

ensure_nginx() {
  install -d -m 0755 /var/www/envo-acme
  install -m 0644 "$BUNDLE/deploy/nginx/envo-headers.conf" /etc/nginx/snippets/envo-headers.conf
  local cert_dir="/etc/letsencrypt/live/$CERT_NAME"

  if [ ! -f "$cert_dir/fullchain.pem" ]; then
    # Serve the ACME challenge for every name first, on both 80 and 443 (a name may be proxied
    # to HTTPS by a CDN), using any certificate we already have.
    local bootstrap="$cert_dir"
    local d
    for d in /etc/letsencrypt/live/*/; do
      [ -f "$d/fullchain.pem" ] && bootstrap="${d%/}" && break
    done
    if [ -f "$bootstrap/fullchain.pem" ]; then
      write_nginx_site "$bootstrap"
    else
      log "no certificate yet; serving ACME over HTTP only"
      printf 'server {\n listen 80;\n listen [::]:80;\n server_name %s;\n location ^~ /.well-known/acme-challenge/ { root /var/www/envo-acme; }\n location / { return 404; }\n}\n' \
        "$(all_domains | tr '\n' ' ')" > /etc/nginx/sites-available/envo
      ln -sf /etc/nginx/sites-available/envo /etc/nginx/sites-enabled/envo
      nginx -t -q && systemctl reload nginx
    fi
    log "requesting a Let's Encrypt certificate for: $(all_domains | tr '\n' ' ')"
    # shellcheck disable=SC2046
    certbot certonly --webroot -w /var/www/envo-acme --cert-name "$CERT_NAME" \
      $(all_domains | sed 's/^/-d /' | tr '\n' ' ') \
      --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring
  else
    # Add any hostname that is not on the certificate yet.
    local missing=0
    for d in $(all_domains); do
      openssl x509 -in "$cert_dir/fullchain.pem" -noout -text | grep -q "DNS:$d\b" || missing=1
    done
    if [ "$missing" = 1 ]; then
      log "expanding certificate to: $(all_domains | tr '\n' ' ')"
      # shellcheck disable=SC2046
      certbot certonly --webroot -w /var/www/envo-acme --cert-name "$CERT_NAME" \
        $(all_domains | sed 's/^/-d /' | tr '\n' ' ') --non-interactive --agree-tos --expand
    fi
  fi

  write_nginx_site "$cert_dir"

  # Renewals: reload nginx and hand the certificate to Asterisk's SIP TLS transport.
  install -d /etc/letsencrypt/renewal-hooks/deploy
  cat > /etc/letsencrypt/renewal-hooks/deploy/envo.sh <<EOF
#!/bin/sh
[ "\$RENEWED_LINEAGE" = "/etc/letsencrypt/live/$CERT_NAME" ] || exit 0
install -o root -g asterisk -m 0640 "\$RENEWED_LINEAGE/fullchain.pem" /etc/asterisk/keys/envo.crt
install -o root -g asterisk -m 0640 "\$RENEWED_LINEAGE/privkey.pem" /etc/asterisk/keys/envo.key
systemctl reload nginx
# TLS transports pick up a new certificate on restart; wait until no calls are up.
/usr/sbin/asterisk -rx 'core restart when convenient' >/dev/null 2>&1 || true
EOF
  chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/envo.sh
  install -o root -g asterisk -m 0640 "$cert_dir/fullchain.pem" /etc/asterisk/keys/envo.crt
  install -o root -g asterisk -m 0640 "$cert_dir/privkey.pem" /etc/asterisk/keys/envo.key
}

install_release() {
  local dest="/opt/envo/releases/$VERSION"
  log "installing release $VERSION"
  rm -rf "$dest"
  install -d -m 0755 "$dest"
  cp -r "$BUNDLE/server" "$BUNDLE/web" "$dest/"
  chmod -R a+rX,go-w "$dest"
  ln -sfn "$dest" /opt/envo/current.new
  mv -T /opt/envo/current.new /opt/envo/current
  if grep -q '^ENVO_VERSION=' "$ENV_FILE"; then
    sed -i "s|^ENVO_VERSION=.*|ENVO_VERSION=$VERSION|" "$ENV_FILE"
  else
    echo "ENVO_VERSION=$VERSION" >> "$ENV_FILE"
  fi
  systemctl restart envo.service
  for _ in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:4310/api/health >/dev/null 2>&1; then
      log "Envo is up: $(curl -fsS http://127.0.0.1:4310/api/health)"
      break
    fi
    sleep 1
  done
  curl -fsS http://127.0.0.1:4310/api/health >/dev/null || { journalctl -u envo -n 50 --no-pager; exit 1; }
  # Keep the five newest releases.
  ls -1dt /opt/envo/releases/* | tail -n +6 | xargs -r rm -rf
}

case "$MODE" in
  setup)
    ensure_users
    ensure_secrets
    load_env
    ensure_dirs
    write_asterisk_config
    ensure_database
    ensure_node
    ensure_piper
    install_units
    ensure_firewall
    ensure_nginx
    ensure_backups
    install_release
    ensure_database # grants on tables created by the first migration
    if systemctl is-active --quiet asterisk.service; then
      # Never drop live calls on a re-run; transport changes need a manual restart.
      log "reloading Asterisk configuration"
      asterisk -rx 'core reload' >/dev/null
    else
      log "starting Asterisk"
      systemctl start asterisk.service
    fi
    ensure_fail2ban
    sleep 3
    systemctl --no-pager --lines=0 status asterisk.service envo.service | grep -E "Active:|●" || true
    log "done. Dashboard: https://$DOMAIN  (admin: $ENVO_ADMIN_EMAIL)"
    ;;
  release)
    load_env
    install_release
    ;;
  *)
    echo "usage: install.sh setup|release" >&2
    exit 2
    ;;
esac
