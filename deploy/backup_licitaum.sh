#!/usr/bin/env bash
# Backup completo e verificado do LicitaUM: banco SQLite + anexos + propostas geradas.
# Não apaga nada: cada execução cria uma pasta nova com data e hora.
#
# Uso:  sudo bash /opt/licitaum/deploy/backup_licitaum.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/licitaum}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/licitaum}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$BACKUP_ROOT/$STAMP"
DB="$APP_DIR/licitacoes.db"
PY="$APP_DIR/.venv/bin/python"
[[ -x "$PY" ]] || PY="python3"

if [[ ! -f "$DB" ]]; then
  echo "ERRO: banco não encontrado em $DB" >&2
  exit 1
fi

mkdir -p "$DEST"
chmod 700 "$BACKUP_ROOT" "$DEST"

echo "==> Copiando o banco com a API de backup do SQLite (seguro com o serviço rodando)"
"$PY" - "$DB" "$DEST/licitacoes.db" <<'PYEOF' | tee "$DEST/contagem.txt"
import sqlite3, sys
src = sqlite3.connect(sys.argv[1])
dst = sqlite3.connect(sys.argv[2])
with dst:
    src.backup(dst)
result = dst.execute("PRAGMA integrity_check").fetchone()[0]
if result != "ok":
    sys.exit(f"FALHA na verificação de integridade do backup: {result}")
print("integridade: ok")
tables = [r[0] for r in dst.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
for table in tables:
    count = dst.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
    print(f"{table:<24} {count}")
src.close()
dst.close()
PYEOF

for folder in uploads propostas_geradas; do
  if [[ -d "$APP_DIR/$folder" ]]; then
    echo "==> Compactando $folder"
    tar -czf "$DEST/$folder.tar.gz" -C "$APP_DIR" "$folder"
  fi
done

(cd "$APP_DIR" && git rev-parse HEAD > "$DEST/commit.txt" 2>/dev/null) || true
(cd "$DEST" && sha256sum ./* > SHA256SUMS)

echo
echo "Backup concluído em: $DEST"
ls -lh "$DEST"
echo
echo "Recomendado: copie esta pasta para fora do servidor (ex.: scp -r para o seu computador)."
