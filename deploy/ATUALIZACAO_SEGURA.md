# Atualização segura em produção (sem perder dados)

Este guia vale para qualquer atualização do LicitaUM e, em especial, para o **revamp visual (fases 1, 2 e 3)**.

## O que as fases 1, 2 e 3 alteram

Somente arquivos de interface:

- `static/index.html`
- `static/styles.css`
- `static/app.js`
- `deploy/backup_licitaum.sh` e este guia (novos)
- `.gitignore` (passa a ignorar `uploads/` e `_backup/`)

O `server.py` **não foi alterado**: nenhuma tabela, coluna ou dado do banco é tocado. O banco (`licitacoes.db`), os anexos (`uploads/`) e as propostas (`propostas_geradas/`) ficam onde estão.

O servidor lê os arquivos de `static/` do disco a cada acesso, então **não é preciso reiniciar o serviço** para a nova interface aparecer.

---

## Passo 1 — Backup (obrigatório, antes de qualquer coisa)

Na primeira vez o script de backup ainda não está no servidor. Faça o backup manual, parando o serviço por alguns segundos para garantir uma cópia 100% consistente:

```bash
STAMP=$(date +%Y%m%d-%H%M%S)
sudo mkdir -p /var/backups/licitaum/$STAMP
sudo systemctl stop licitaum
sudo cp -a /opt/licitaum/licitacoes.db /var/backups/licitaum/$STAMP/
sudo tar -czf /var/backups/licitaum/$STAMP/uploads.tar.gz -C /opt/licitaum uploads
sudo tar -czf /var/backups/licitaum/$STAMP/propostas_geradas.tar.gz -C /opt/licitaum propostas_geradas
cd /opt/licitaum && sudo git rev-parse HEAD | sudo tee /var/backups/licitaum/$STAMP/commit.txt
sudo systemctl start licitaum
ls -lh /var/backups/licitaum/$STAMP
```

Confirme que `licitacoes.db` aparece na listagem com tamanho maior que zero.

Das próximas vezes, basta:

```bash
sudo bash /opt/licitaum/deploy/backup_licitaum.sh
```

(o script faz a cópia com o serviço rodando, verifica a integridade e lista quantos registros há em cada tabela).

**Recomendado:** copie o backup para fora do servidor, por exemplo do seu computador:

```bash
scp -r usuario@SEU-SERVIDOR:/var/backups/licitaum/AAAAMMDD-HHMMSS ./backup-licitaum/
```

## Passo 2 — Contagem de registros (antes)

```bash
cd /opt/licitaum
sudo .venv/bin/python -c "import sqlite3; c=sqlite3.connect('licitacoes.db'); [print(t, c.execute(f'SELECT COUNT(*) FROM \"{t}\"').fetchone()[0]) for (t,) in c.execute(\"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name\")]" | tee /tmp/contagem-antes.txt
```

## Passo 3 — Conferir que o Git não vai mexer nos dados

```bash
cd /opt/licitaum
sudo git status --short
sudo git ls-files | grep -E '\.db$|^uploads/|^propostas_geradas/' || echo "OK: nenhum dado rastreado pelo git"
```

- O segundo comando **precisa** responder `OK: nenhum dado rastreado pelo git`.
- Se ele listar algum arquivo (`licitacoes.db`, algo em `uploads/`…), **pare aqui** e não faça o `git pull`: um pull poderia sobrescrever ou remover esse arquivo.
- Se o `git status` mostrar arquivos modificados em `static/`, alguém editou direto no servidor; anote antes de continuar.

## Passo 4 — Atualizar

```bash
cd /opt/licitaum
sudo git pull --ff-only
sudo chown -R licitaum:licitaum /opt/licitaum
```

Não é necessário reiniciar. Se quiser reiniciar mesmo assim, é seguro: `sudo systemctl restart licitaum`.

## Passo 5 — Conferir (depois)

```bash
cd /opt/licitaum
sudo .venv/bin/python -c "import sqlite3; c=sqlite3.connect('licitacoes.db'); [print(t, c.execute(f'SELECT COUNT(*) FROM \"{t}\"').fetchone()[0]) for (t,) in c.execute(\"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name\")]" | tee /tmp/contagem-depois.txt
diff /tmp/contagem-antes.txt /tmp/contagem-depois.txt && echo "OK: mesmas contagens"
```

As contagens só podem diferir se alguém usou o sistema entre os passos 2 e 5 (por exemplo, cadastrou um item).

No navegador, abra o LicitaUM e pressione **Ctrl+F5**.

---

## Voltar a interface antiga (se precisar)

Isso só troca os arquivos de interface; o banco não é tocado:

```bash
cd /opt/licitaum
sudo git checkout $(cat /var/backups/licitaum/AAAAMMDD-HHMMSS/commit.txt) -- static/
sudo chown -R licitaum:licitaum /opt/licitaum/static
```

## Restaurar o banco a partir de um backup (emergência)

```bash
sudo systemctl stop licitaum
sudo cp -a /opt/licitaum/licitacoes.db /opt/licitaum/licitacoes.db.antes-da-restauracao
sudo cp -a /var/backups/licitaum/AAAAMMDD-HHMMSS/licitacoes.db /opt/licitaum/licitacoes.db
sudo chown licitaum:licitaum /opt/licitaum/licitacoes.db
sudo systemctl start licitaum
```

Os anexos são restaurados com `sudo tar -xzf .../uploads.tar.gz -C /opt/licitaum`.
