#!/usr/bin/env bash
# AlphaCore and its local model on one small VPS — 2 vCPU, 8 GB, Ubuntu 22.04 or 24.04.
#
#   sudo bash install.sh                           # console reachable only through an SSH tunnel
#   sudo DOMAIN=ops.example.com bash install.sh    # HTTPS on a domain you point at this server
#   sudo RUNTIME=ollama bash install.sh            # Ollama instead of the built-in engine
#
# What it does, in order, and why:
#   1. A 4 GB swap file. Loading a 7B model briefly needs more than it keeps;
#      without swap the kernel kills something to make room, and it is usually
#      the wrong thing.
#   2. Node 22 (node:sqlite). By default nothing else: AlphaCore downloads and
#      runs llama.cpp itself (the built-in engine). With RUNTIME=ollama it
#      installs Ollama instead, bound to 127.0.0.1, one model at a time.
#   3. Either way the model runs at a lower CPU weight than the console, so a
#      long answer never makes the page stop responding.
#   4. The models that fit: a 3B model for everyday work and an embedding model
#      for search (ENGINE_MODELS), or for Ollama qwen2.5:3b / 7b (MODELS).
#   5. AlphaCore as a service, with the local model switched on and local-first.
#   6. A firewall that lets in SSH and, with a domain, 80 and 443 — nothing else.
#      The model port is never opened.
#
# Re-running it is safe: every step checks before it acts.
set -euo pipefail

REPO="${REPO:-https://github.com/itzzexe/ALPHACORE.git}"
BRANCH="${BRANCH:-main}"
DIR="${DIR:-/opt/alphacore/ALPHACORE}"
DOMAIN="${DOMAIN:-}"
MODELS="${MODELS:-qwen2.5:3b qwen2.5:7b nomic-embed-text}"
FAST_MODEL="${FAST_MODEL:-qwen2.5:3b}"
DEEP_MODEL="${DEEP_MODEL:-qwen2.5:7b}"
SWAP_GB="${SWAP_GB:-4}"
RUNTIME="${RUNTIME:-engine}"
ENGINE_MODELS="${ENGINE_MODELS:-qwen2.5-3b-instruct-q4_k_m nomic-embed-text-v1.5-q8_0}"

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "run as root: sudo bash $0"; exit 1; }
. /etc/os-release
case "${ID:-}" in ubuntu|debian) ;; *) echo "written for Ubuntu/Debian; this is ${ID:-unknown}"; exit 1 ;; esac

say "packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates ufw zstd

say "swap (${SWAP_GB} GB)"
if ! swapon --show | grep -q '^/swapfile'; then
  fallocate -l "${SWAP_GB}G" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
# Swap is the safety net, not the working set: prefer dropping file cache.
sysctl -w vm.swappiness=10 >/dev/null
grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf

say "Node 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node --version

if [ "$RUNTIME" = "ollama" ]; then
say "Ollama"
if ! command -v ollama >/dev/null; then
  curl -fsSL https://ollama.com/install.sh | sh
fi
mkdir -p /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/alphacore.conf <<'EOF'
[Service]
# Loopback only. The console reaches it on this machine; nothing else can.
Environment=OLLAMA_HOST=127.0.0.1:11434
# Two cores: one answer at a time is faster than two at half speed each.
Environment=OLLAMA_NUM_PARALLEL=1
Environment=OLLAMA_MAX_LOADED_MODELS=1
Environment=OLLAMA_KEEP_ALIVE=30m
# A smaller KV cache for the same window, so a 7B model fits beside the console.
Environment=OLLAMA_FLASH_ATTENTION=1
Environment=OLLAMA_KV_CACHE_TYPE=q8_0
# The console outranks the model for CPU: a long answer must not freeze the page.
CPUWeight=50
Nice=5
EOF
systemctl daemon-reload
systemctl enable --now ollama
systemctl restart ollama
for i in $(seq 1 30); do curl -fs http://127.0.0.1:11434/api/version >/dev/null && break; sleep 1; done

say "models: ${MODELS}"
for m in $MODELS; do ollama pull "$m"; done
fi

say "AlphaCore"
id alphacore >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/alphacore --shell /usr/sbin/nologin alphacore
if [ ! -d "$DIR/.git" ]; then
  mkdir -p "$(dirname "$DIR")"
  git clone --branch "$BRANCH" "$REPO" "$DIR"
else
  git config --global --add safe.directory "$DIR"
  git -C "$DIR" pull --ff-only
fi
cd "$DIR/app"
npm ci --omit=dev
mkdir -p data workspace

# Settings the platform reads from the environment. Anything changed later on
# the Local AI page is a database setting and beats these.
if [ ! -f .env ] && [ "$RUNTIME" = "engine" ]; then
  cat > .env <<EOF
PORT=8484
ENGINE_ENABLED=true
LOCAL_RUNTIME=engine
LOCAL_FIRST=true
LOCAL_NUM_CTX=4096
LOCAL_NUM_THREAD=2
LOCAL_CONCURRENCY=1
VPS_RAM_GB=$(awk '/MemTotal/ {printf "%.1f", $2/1048576}' /proc/meminfo)
VPS_CPUS=$(nproc)
EOF
fi
if [ ! -f .env ]; then
  cat > .env <<EOF
PORT=8484
OLLAMA_ENABLED=true
OLLAMA_BASE_URL=http://127.0.0.1:11434
LOCAL_FIRST=true
LOCAL_MODEL_T1=${FAST_MODEL}
LOCAL_MODEL_T2=${FAST_MODEL}
LOCAL_MODEL_T3=${DEEP_MODEL}
LOCAL_MODEL_TL=${DEEP_MODEL}
LOCAL_NUM_CTX=4096
LOCAL_NUM_THREAD=2
LOCAL_CONCURRENCY=1
EMBEDDING_MODEL=nomic-embed-text
VPS_RAM_GB=$(awk '/MemTotal/ {printf "%.1f", $2/1048576}' /proc/meminfo)
VPS_CPUS=$(nproc)
EOF
fi
chown -R alphacore:alphacore /opt/alphacore

if [ "$RUNTIME" = "engine" ]; then
  say "the built-in engine: llama.cpp and ${ENGINE_MODELS}"
  apt-get install -y libgomp1 >/dev/null 2>&1 || true
  sudo -u alphacore -H bash -c "cd '$DIR/app' && node --experimental-sqlite scripts/engine-setup.mjs ${ENGINE_MODELS}"
fi

sed -e "s#/opt/alphacore/crucible-core#${DIR}/app#g" \
    -e "s#^Description=.*#Description=AlphaCore — the company that runs itself (with its local model)#" \
    -e "s#^After=network-online.target#After=network-online.target ollama.service#" \
    -e "s#^Wants=network-online.target#Wants=network-online.target ollama.service#" \
    deploy/alphacore.service > /etc/systemd/system/alphacore.service
if [ -z "$DOMAIN" ]; then
  # No proxy in front, so a forwarded-for header is somebody lying.
  sed -i 's#^Environment=TRUST_PROXY=true#Environment=TRUST_PROXY=false#' /etc/systemd/system/alphacore.service
fi
grep -q '^CPUWeight' /etc/systemd/system/alphacore.service || sed -i 's#^\[Service\]#[Service]\nCPUWeight=200#' /etc/systemd/system/alphacore.service
systemctl daemon-reload
systemctl enable --now alphacore
systemctl restart alphacore

say "firewall"
ufw allow OpenSSH
if [ -n "$DOMAIN" ]; then
  say "HTTPS for ${DOMAIN}"
  if ! command -v caddy >/dev/null; then
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https gnupg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y && apt-get install -y caddy
  fi
  cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
  encode gzip
  reverse_proxy 127.0.0.1:8484
}
EOF
  systemctl reload caddy || systemctl restart caddy
  ufw allow 80/tcp
  ufw allow 443/tcp
fi
ufw --force enable

say "done"
sleep 3
PW=$(journalctl -u alphacore --no-pager | grep -m1 -E '^\s*.*password\s+[a-z0-9]{4}-' | awk '{print $NF}' || true)
cat <<EOF

  AlphaCore is running with its own model.

  Open it:
$( [ -n "$DOMAIN" ] && echo "    https://${DOMAIN}" || echo "    from your computer:  ssh -L 8484:127.0.0.1:8484 root@<this-server>   then  http://localhost:8484" )

  First sign-in:  owner / ${PW:-<run: journalctl -u alphacore | grep password>}
  (shown once; you will be asked to change it)

  Then open  Work → Local AI  to benchmark the models on this machine,
  and  Markets  to switch the desk and the newsroom onto live data.

  Logs:  journalctl -u alphacore -f     journalctl -u ollama -f
EOF
