# LicitaUM

Primeira versão local para centralizar:

- cadastro de pregões e órgãos;
- itens, marcas, modelos, links e preços de cadastro;
- licitações ganhas / habilitadas;
- futuras licitações que ainda serão acompanhadas ou precificadas;
- encomendas, ordens de fornecimento, notas de empenho e endereço de entrega;
- geração de proposta a partir do modelo original, selecionando um ou mais itens.

## Como abrir

Execute `iniciar_sistema.bat` e acesse:

```text
http://127.0.0.1:8765
```

O banco local fica em `licitacoes.db`. As propostas geradas ficam em `propostas_geradas`.

## Propostas

Na tela de detalhe de uma licitação, marque os itens desejados e clique em `Gerar DOCX` ou `Gerar PDF`.

O `DOCX` é gerado a partir do arquivo `modelo_proposta_vogen.docx`, preservando cabeçalho, logo, formatação e declarações do modelo enviado. O sistema altera apenas órgão/UASG, tabela de itens, valor total por extenso e data.

Cada item selecionado para proposta precisa ter `Link do fornecedor para proposta` preenchido.

O `PDF` depende de um conversor instalado e funcionando. Em Linux, o caminho recomendado é LibreOffice em modo headless. No Windows, o sistema tenta LibreOffice primeiro e Microsoft Word depois.

## Servidor Linux

Sim, o LicitaUM pode rodar em Linux. A primeira versão usa Python, SQLite e arquivos estáticos, então a migração natural é instalar Python 3, `python-docx`, LibreOffice e rodar o app por um serviço `systemd` atrás de Nginx/Caddy. A geração de DOCX funciona em Linux. A geração de PDF funciona melhor em Linux com `libreoffice --headless --convert-to pdf`.

Os arquivos de deploy ficam em `deploy/`:

- `deploy/install_ubuntu.sh`: instala dependências, clona/atualiza o repo, cria venv, instala Python deps, configura serviço e Nginx.
- `deploy/licitaum.service`: serviço `systemd`.
- `deploy/nginx.conf`: proxy Nginx.
- `deploy/README_DEPLOY.md`: passo a passo para GitHub e servidor.

## Próximos aprimoramentos sugeridos

- importar as planilhas atuais para dentro do banco;
- criar usuários e permissões para cada pessoa preencher preços;
- configurar conversão automática estável para PDF;
- exportar relatórios por status, órgão, pregão e período;
- anexar editais, empenhos e notas fiscais em cada licitação.
