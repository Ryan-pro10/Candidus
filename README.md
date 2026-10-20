# Candidus Gestão Financeira

Sistema financeiro multiempresa para BPO financeiro e controladoria (uso interno).
HTML + CSS + JavaScript puro, sem build, com Supabase (PostgreSQL + Auth + Storage) e deploy no Vercel.

Estado atual, roadmap e decisões: [docs/ESTADO-DO-PROJETO.md](docs/ESTADO-DO-PROJETO.md).

## Estrutura

```
index.html              estrutura da página + lista de <script> (a ordem importa)
css/styles.css          todo o visual (inclui modo noite)
img/                    logos
js/
  config.js             URL e anon key do Supabase
  core.js               Supabase, formatação, toast, modais e helpers compartilhados
  dashboard.js
  financeiro/           contas a receber/pagar, fluxo de caixa, cartões, importar extrato,
                        conciliação (+ regras), lançamento em lote, baixa em lote, recorrentes
  cadastros/            clientes/fornecedores/CC/contas, categorias, empresas
  bpo/                  pendências, tarefas, documentos
  controladoria/        DRE, orçamento, realizado×orçado, indicadores, custos, fixo×variável
  app.js                menu, favoritos, rotas das telas, tema, login, boot() — sempre o último
supabase/
  candidus_completo.sql banco inteiro do zero (só em Supabase novo/vazio)
  historico/            SQLs por etapa, na ordem em que foram rodados
docs/                   documentação do projeto
exemplos/               arquivos de teste (extrato OFX)
tools/verificar.mjs     checagem antes de publicar
```

## Rodar localmente

Os scripts são arquivos separados, então abra por um servidor (não com duplo clique):

```
npx serve .
```

e acesse o endereço que aparecer. A anon key precisa estar em `js/config.js`.

## Antes de publicar

```
node tools/verificar.mjs
```

Confere sintaxe de cada arquivo, nomes globais duplicados entre arquivos (redeclarar uma
`function` não dá erro no navegador, a última vence e quebra a outra em silêncio) e arquivos
em `js/` que o `index.html` esqueceu de carregar.

## Adicionar uma tela nova

1. Criar `js/<área>/<tela>.js` com a função `renderX()`.
2. Pôr o `<script src>` no `index.html`, antes do `js/app.js`.
3. Adicionar o item no `MENU` e o caso no `setView()` (os dois em `js/app.js`).
4. Helper que outro módulo também vai usar vai para `js/core.js`.

## Banco

Atualizar um banco que já existe:
1. Rodar `supabase/diagnostico.sql` no SQL Editor (só lê). Ele mostra quais etapas de
   `supabase/historico/` já estão no banco.
2. Rodar **só as que aparecem como FALTA**, em ordem. Não reexecute etapas que já estão:
   01, 03, 06 e 09 dão erro de tabela existente, e a 14 dá erro se a 17 já foi aplicada.
3. Se o bucket `documentos` aparecer como FALTA (ou o app der "permission denied"),
   rodar `supabase/acessos_storage.sql` (pode repetir sem problema).

`candidus_completo.sql` é só para Supabase novo/vazio. Testado: banco atualizado pelo
histórico fica idêntico a um criado pelo completo.

Mudou a lista de parâmetros de uma função SQL? Dropar as versões antigas antes do
`create or replace`, senão o PostgREST fica com duas versões e dá "could not choose function"
(ver `supabase/historico/10_candidus_fix_funcoes.sql`).
