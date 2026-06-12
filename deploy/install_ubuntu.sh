#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/licitaum}"
APP_USER="${APP_USER:-licitaum}"
REPO_URL="${REPO_URL:-}"
DOMAIN="${DOMAIN:-}"

if [[ -z "$REPO_URL" ]]; then
  echo "Defina REPO_URL antes de executar. Exemplo:"
  echo "REPO_URL=https://github.com/seu-usuario/licitaum.git sudo -E bash deploy/install_ubuntu.sh"
  exit 1
fi

apt-get update
apt-get install -y python3 python3-venv python3-pip git libreoffice nginx

if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi

mkdir -p "$APP_DIR"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO_URL" "$APP_DIR"
fi

python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install --upgrade pip
"$APP_DIR/.venv/bin/pip" install -r "$APP_DIR/requirements.txt"

mkdir -p "$APP_DIR/propostas_geradas" "$APP_DIR/uploads"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

cp "$APP_DIR/deploy/licitaum.service" /etc/systemd/system/licitaum.service
systemctl daemon-reload
systemctl enable --now licitaum

if [[ -n "$DOMAIN" ]]; then
  sed "s/server_name _;/server_name $DOMAIN;/" "$APP_DIR/deploy/nginx.conf" > /etc/nginx/sites-available/licitaum
else
  cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/licitaum
fi
ln -sf /etc/nginx/sites-available/licitaum /etc/nginx/sites-enabled/licitaum
nginx -t
systemctl reload nginx

echo "LicitaUM instalado."
echo "Status: systemctl status licitaum"
echo "Logs: journalctl -u licitaum -f"
