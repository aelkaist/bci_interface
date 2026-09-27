#!/usr/bin/env bash
# Serve the dashboard behind HTTP Basic Auth and expose it through a
# Cloudflare quick tunnel. Prints the public URL when it is ready.
#
#   ./serve_public.sh          start (or restart) app + tunnel
#   ./serve_public.sh stop     stop both
#
# Credentials live in ~/.dash_credentials (chmod 600, outside the repo).
# The app itself only ever binds 127.0.0.1 — the tunnel is the sole way in.
set -euo pipefail

CRED="$HOME/.dash_credentials"
LOGDIR="$HOME/.dash_logs"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$LOGDIR"

stop() {
  pkill -f "python $HERE/app.py" 2>/dev/null || true
  pkill -f "^python app.py" 2>/dev/null || true
  pkill -f "cloudflared tunnel --url http://127.0.0.1:8050" 2>/dev/null || true
  echo "stopped app + tunnel"
}

if [ "${1:-start}" = "stop" ]; then stop; exit 0; fi

if [ ! -f "$CRED" ]; then
  PW=$(python -c "import secrets,string;print(''.join(secrets.choice(string.ascii_letters+string.digits) for _ in range(20)))")
  printf 'export DASH_USER="kixlab"\nexport DASH_PASS="%s"\n' "$PW" > "$CRED"
  chmod 600 "$CRED"
  echo "created $CRED"
fi
# shellcheck source=/dev/null
. "$CRED"

stop; sleep 2

cd "$HERE"
setsid nohup env DASH_USER="$DASH_USER" DASH_PASS="$DASH_PASS" \
  python app.py > "$LOGDIR/app.log" 2>&1 < /dev/null & disown
for _ in $(seq 40); do
  sleep 1
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:8050/" || true)
  [ "$code" = "401" ] && break
done
[ "${code:-}" = "401" ] || { echo "app failed to start; see $LOGDIR/app.log"; exit 1; }
echo "app up on 127.0.0.1:8050 (auth required)"

setsid nohup "$HOME/.local/bin/cloudflared" tunnel --url http://127.0.0.1:8050 \
  --no-autoupdate > "$LOGDIR/tunnel.log" 2>&1 < /dev/null & disown
URL=""
for _ in $(seq 40); do
  sleep 1
  URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$LOGDIR/tunnel.log" | head -1 || true)
  [ -n "$URL" ] && break
done
[ -n "$URL" ] || { echo "tunnel failed; see $LOGDIR/tunnel.log"; exit 1; }

echo
echo "  URL:      $URL"
echo "  user:     $DASH_USER"
echo "  password: $DASH_PASS"
echo
echo "Quick tunnels are ephemeral: the URL changes every restart and dies with"
echo "the process. Logs: $LOGDIR/{app,tunnel}.log"
