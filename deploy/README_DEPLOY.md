# Deploy do LicitaUM em Ubuntu/Debian

## 1. Subir para o GitHub

No computador onde houver `git` instalado:

```bash
git init
git add server.py static requirements.txt README.md deploy modelo_proposta_vogen.docx iniciar_sistema.bat .gitignore
git commit -m "Primeira versão do LicitaUM"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/licitaum.git
git push -u origin main
```

## 2. Instalar no servidor

No servidor Linux:

```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/SEU-USUARIO/licitaum.git /tmp/licitaum
cd /tmp/licitaum
REPO_URL=https://github.com/SEU-USUARIO/licitaum.git DOMAIN=seudominio.com.br sudo -E bash deploy/install_ubuntu.sh
```

Sem domínio, omita `DOMAIN=...`.

## 3. Verificar

```bash
systemctl status licitaum
journalctl -u licitaum -f
```

## DOCX e PDF

O DOCX é gerado com `python-docx`.

O PDF em Linux usa LibreOffice headless, instalado pelo script:

```bash
libreoffice --headless --convert-to pdf arquivo.docx
```

## Atualizar versão

Depois de fazer novo push no GitHub:

```bash
cd /opt/licitaum
sudo git pull --ff-only
sudo systemctl restart licitaum
```
