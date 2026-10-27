#!/usr/bin/env bash
# Close SSH to passwords, keep it open to keys.
#
#   sudo bash harden-ssh.sh
#
# A root password that has ever been typed into a chat, an email or a ticket
# should be assumed known. With keys only, knowing it is no longer enough.
#
# It refuses to run unless root already has an authorised key — the one way to
# lock yourself out of a server is to switch passwords off before a key works.
# The change goes into a drop-in file (sshd_config.d), so the main config and
# whatever else the server's other services set there are left alone, and
# `sshd -t` checks it before the service is reloaded.
set -euo pipefail

KEYS=/root/.ssh/authorized_keys
DROPIN=/etc/ssh/sshd_config.d/10-alphacore-keys-only.conf

if [ ! -s "$KEYS" ] || ! grep -qE '^(ssh-(ed25519|rsa)|ecdsa-sha2)' "$KEYS"; then
  echo "No key in ${KEYS} — refusing. Add yours first (ssh-copy-id), then run this again."
  exit 1
fi

cat > "$DROPIN" <<'CONF'
# Written by AlphaCore's harden-ssh.sh: keys only, for root and everyone else.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
CONF

sshd -t
systemctl reload ssh 2>/dev/null || systemctl reload sshd
echo "SSH now accepts keys only. Keep this session open and test a new login in another window before closing it."
