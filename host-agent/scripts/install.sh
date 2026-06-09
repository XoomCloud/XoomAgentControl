#!/usr/bin/env bash
# Installs the XoomAgent Host Agent as a systemd service on a Hetzner KVM host.
# Run as root on Ubuntu Server 24.04 LTS.
set -euo pipefail

INSTALL_DIR=/opt/xoomagent/host-agent
ETC_DIR=/etc/xoomagent
STATE_DIR=/var/lib/xoomagent

echo "==> Creating xoomagent user + directories"
id -u xoomagent >/dev/null 2>&1 || useradd --system --home "$STATE_DIR" --shell /usr/sbin/nologin xoomagent
mkdir -p "$INSTALL_DIR" "$ETC_DIR" "$STATE_DIR/tenants" "$STATE_DIR/images"
chown -R xoomagent:xoomagent "$STATE_DIR"

echo "==> Copying agent build"
cp -r ./dist "$INSTALL_DIR/"
cp -r ./node_modules "$INSTALL_DIR/" 2>/dev/null || true

echo "==> Installing systemd unit"
cp ./systemd/xoom-host-agent.service /etc/systemd/system/
[ -f "$ETC_DIR/agent.env" ] || cp ./systemd/agent.env.example "$ETC_DIR/agent.env"
chmod 600 "$ETC_DIR/agent.env"

echo "==> Running preflight"
node "$INSTALL_DIR/dist/index.js" preflight || echo "WARNING: preflight reported issues; review before enabling."

systemctl daemon-reload
echo "==> Done. Edit $ETC_DIR/agent.env then: systemctl enable --now xoom-host-agent"
