#!/usr/bin/env bash
# Build Envo locally and ship it.
#   deploy/deploy.sh                      # release to the office server (enfinitos1, PM2)
#   ENVO_TARGET=vps deploy/deploy.sh      # release to the old Hostinger VPS (systemd, /opt/envo)
#   ENVO_TARGET=vps deploy/deploy.sh setup  # first install / re-provision the VPS
#
# Office server: enfinito@103.129.209.29 (behind the office MikroTik, LAN 192.168.20.237). The app
# runs as PM2 process "envo" from ~/apps/envo (ecosystem.config.cjs holds its env and secrets and is
# never touched here); nginx serves ~/apps/envo/web. Each release is kept in ~/apps/envo/releases/;
# a release whose /api/health check fails is rolled back automatically.
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${ENVO_TARGET:-office}"
MODE="${1:-release}"
VERSION="$(date +%Y%m%d-%H%M%S)"

case "$TARGET" in
  office)
    HOST="${ENVO_SSH_HOST:-enfinito@103.129.209.29}"
    PORT="${ENVO_SSH_PORT:-22}"
    KEY="${ENVO_SSH_KEY:-$HOME/.ssh/envo_office_ed25519}"
    if [ "$MODE" != release ]; then
      echo "[deploy] the office server was provisioned by hand; only 'release' is supported" >&2
      exit 1
    fi
    ;;
  vps)
    HOST="${ENVO_SSH_HOST:-root@72.60.104.105}"
    PORT="${ENVO_SSH_PORT:-61022}"
    KEY="${ENVO_SSH_KEY:-$HOME/.ssh/envo_vps_ed25519}"
    ;;
  *)
    echo "[deploy] unknown ENVO_TARGET '$TARGET' (office or vps)" >&2
    exit 1
    ;;
esac
SSH=(ssh -i "$KEY" -p "$PORT" -o BatchMode=yes "$HOST")

echo "[deploy] building server"
(cd server && npm run --silent build >/dev/null)
echo "[deploy] building web"
(cd web && npm run --silent build >/dev/null)

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/envo/server" "$STAGE/envo/web"
cp server/dist/index.mjs server/dist/index.mjs.map "$STAGE/envo/server/"
cp -r web/dist/. "$STAGE/envo/web/"
if [ "$TARGET" = vps ]; then cp -r deploy "$STAGE/envo/deploy"; fi
echo "$VERSION" > "$STAGE/envo/VERSION"
tar -czf "$STAGE/envo.tgz" -C "$STAGE" envo

echo "[deploy] uploading $VERSION to $HOST ($TARGET)"
scp -q -i "$KEY" -P "$PORT" -o BatchMode=yes "$STAGE/envo.tgz" "$HOST:/tmp/envo-$VERSION.tgz"

if [ "$TARGET" = office ]; then
  "${SSH[@]}" "VERSION=$VERSION bash -s" <<'REMOTE'
set -euo pipefail
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null
APP="$HOME/apps/envo"
REL="$APP/releases"
mkdir -p "$REL"

# The first scripted release keeps the hand-installed build as "initial" so it can be restored.
[ -e "$APP/VERSION" ] || echo initial > "$APP/VERSION"
CUR="$(cat "$APP/VERSION")"
if [ ! -d "$REL/$CUR" ]; then
  mkdir -p "$REL/$CUR"
  cp -a "$APP/server" "$APP/web" "$REL/$CUR/"
fi

mkdir -p "$REL/$VERSION"
tar -xzf "/tmp/envo-$VERSION.tgz" -C "$REL/$VERSION" --strip-components=1
rm -f "/tmp/envo-$VERSION.tgz"

activate() {
  # Paths stay fixed for PM2 (server/index.mjs) and nginx (web/), so swap directory contents.
  local from="$REL/$1"
  rm -rf "$APP/server.next" "$APP/web.next"
  cp -a "$from/server" "$APP/server.next"
  cp -a "$from/web" "$APP/web.next"
  rm -rf "$APP/server.old" "$APP/web.old"
  mv "$APP/server" "$APP/server.old"; mv "$APP/server.next" "$APP/server"
  mv "$APP/web" "$APP/web.old"; mv "$APP/web.next" "$APP/web"
  rm -rf "$APP/server.old" "$APP/web.old"
  echo "$1" > "$APP/VERSION"
  pm2 restart envo >/dev/null
}

healthy() {
  local i
  for i in $(seq 1 20); do
    sleep 1
    if curl -fsS -m 2 http://127.0.0.1:4310/api/health 2>/dev/null | grep -q '"ok":true'; then
      return 0
    fi
  done
  return 1
}

echo "[remote] activating $VERSION (was $CUR)"
activate "$VERSION"
if healthy; then
  echo "[remote] $VERSION is healthy"
  pm2 save >/dev/null
else
  echo "[remote] $VERSION failed its health check - rolling back to $CUR" >&2
  pm2 logs envo --lines 30 --nostream >&2 || true
  activate "$CUR"
  healthy && echo "[remote] rolled back to $CUR" >&2
  exit 1
fi

# Keep the five newest releases plus the hand-installed "initial" one.
{ ls -1t "$REL" | grep -v '^initial$' || true; } | tail -n +6 | while read -r old; do rm -rf "${REL:?}/$old"; done
REMOTE
else
  REMOTE_ENV=""
  for var in ENVO_ADMIN_EMAIL ENVO_DOMAIN ENVO_SIP_DOMAIN ENVO_EXTRA_DOMAINS ENVO_CERT_NAME ENVO_PUBLIC_IP; do
    eval "value=\${$var:-}"
    [ -n "$value" ] && REMOTE_ENV="$REMOTE_ENV $var=$(printf %q "$value")"
  done
  "${SSH[@]}" "set -e; d=/tmp/envo-$VERSION; rm -rf \$d; mkdir -p \$d; tar -xzf \$d.tgz -C \$d; $REMOTE_ENV bash \$d/envo/deploy/scripts/install.sh $MODE; rm -rf \$d \$d.tgz"
fi
echo "[deploy] done"
