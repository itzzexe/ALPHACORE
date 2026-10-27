#!/usr/bin/env bash
# HTTPS for AlphaCore on a server that already runs nginx for other sites.
#
#   sudo DOMAIN=ops.example.com EMAIL=you@example.com bash https-nginx.sh
#
# install.sh puts Caddy in front and rewrites the firewall, which is right for a
# server of its own and wrong for one shared with other sites. This adds one
# nginx site and nothing else:
#
#   1. Checks the domain already points at this machine — a certificate cannot
#      be issued for a name that resolves somewhere else, and failing early is
#      kinder than a half-made site.
#   2. Writes /etc/nginx/sites-available/alphacore: the console and its live
#      socket (/live) proxied to 127.0.0.1:8484, long timeouts for the model,
#      and uploads up to 30 MB. AlphaCore itself stays bound to localhost.
#   3. Runs `nginx -t` before reloading, so a mistake never takes the other
#      sites down with it.
#   4. Gets a Let's Encrypt certificate with certbot's nginx plugin, which
#      renews itself.
#   5. Tells AlphaCore its public address (PUBLIC_BASE_URL) and to trust the
#      proxy's forwarded address (TRUST_PROXY), so sign-in records, verification
#      codes on printed documents and links in phone messages are right.
#
# It opens 80 and 443 in ufw only if ufw is active and they are not open yet,
# and touches no other rule. Re-running it is safe.
set -euo pipefail

DOMAIN="${DOMAIN:?set DOMAIN=ops.example.com}"
EMAIL="${EMAIL:?set EMAIL for the certificate notices}"
PORT="${PORT:-8484}"
APP_DIR="${APP_DIR:-/opt/alphacore/crucible-core}"
SITE=/etc/nginx/sites-available/alphacore

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "1/5  Does ${DOMAIN} point here?"
mine=$(curl -fsS4 https://api.ipify.org || true)
theirs=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)
if [ -z "$theirs" ] || [ "$mine" != "$theirs" ]; then
  echo "  ${DOMAIN} resolves to '${theirs:-nothing}', this server is '${mine:-unknown}'."
  echo "  Point an A record at ${mine:-this server} and run this again once it has spread."
  exit 1
fi
echo "  yes — ${theirs}"

say "2/5  The nginx site"
cat > "$SITE" <<NGINX
# AlphaCore — written by https-nginx.sh. The app listens on localhost only.
map \$http_upgrade \$alphacore_connection { default upgrade; '' close; }
server {
  listen 80;
  listen [::]:80;
  server_name ${DOMAIN};
  client_max_body_size 30m;
  location /live {
    proxy_pass http://127.0.0.1:${PORT};
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection \$alphacore_connection;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$remote_addr;
    proxy_read_timeout 3600s;
  }
  location / {
    proxy_pass http://127.0.0.1:${PORT};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$remote_addr;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 900s;
    proxy_send_timeout 900s;
  }
}
NGINX
ln -sf "$SITE" /etc/nginx/sites-enabled/alphacore

say "3/5  Checking nginx before reloading it"
nginx -t
systemctl reload nginx

say "4/5  The certificate"
command -v certbot >/dev/null || { apt-get update -q && apt-get install -yq certbot python3-certbot-nginx; }
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw status | grep -qE '^80(/tcp)?\s+ALLOW' || ufw allow 80/tcp
  ufw status | grep -qE '^443(/tcp)?\s+ALLOW' || ufw allow 443/tcp
fi
certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --no-eff-email --redirect -n
nginx -t && systemctl reload nginx

say "5/5  Telling AlphaCore where it lives"
cd "$APP_DIR"
node --experimental-sqlite --input-type=module -e "
  const { setSetting } = await import('./src/settings.js');
  setSetting('PUBLIC_BASE_URL', 'https://${DOMAIN}');
  setSetting('TRUST_PROXY', 'true');
  console.log('  PUBLIC_BASE_URL = https://${DOMAIN}, TRUST_PROXY = true');
"
systemctl restart alphacore

say "Done: https://${DOMAIN}"
echo "  Next, in the console: Settings → Security → require a one-time code of the accounts that can move money."
