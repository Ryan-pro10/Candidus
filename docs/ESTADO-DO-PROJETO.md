# CANDIDUS GESTÃO FINANCEIRA — Estado do Projeto
*(documento para continuar o desenvolvimento em outro chat)*

## O que é
SaaS financeiro **multiempresa** para BPO financeiro + controladoria, uso interno do admin
(gerencia as finanças de vários clientes). **Não** é pra vender como SaaS, não tem portal do
cliente nem cobrança.

## Stack / arquitetura
- **Frontend:** HTML + CSS + JavaScript puro, **sem build**, separado em arquivos (desde 17/10/2026):
  `index.html` (só a estrutura), `css/styles.css`, `img/`, e `js/` com um arquivo por módulo
  (`core.js` = helpers compartilhados, `app.js` = menu/rotas/login, carregado por último).
  Os scripts são `<script src>` clássicos: tudo continua global, a ordem no `index.html` importa.
  Fala direto com o Supabase via `@supabase/supabase-js` (CDN). Deploy no **Vercel** via GitHub.
- **Backend:** **Supabase** (PostgreSQL + Auth + Storage).
- **Segurança:** RLS por empresa (função `has_company_access` + `is_admin`); isolamento testado.
  A `anon key` fica no front (correto; protegida por RLS). Dinheiro em `numeric(14,2)`.
- **Config em `js/config.js`:** `SUPABASE_URL` e `SUPABASE_ANON_KEY`. Com os arquivos separados, só
  esse arquivo tem a chave: dá pra colar uma vez e não mexer mais a cada versão.
- Projeto Supabase atual do usuário: id `bevxncltfexzdoyfyjcw`.

## Como publicar/atualizar
1. `node tools/verificar.mjs` (sintaxe + nomes globais duplicados entre arquivos).
2. Commit/push dos arquivos alterados no GitHub (repositório ligado ao Vercel).
3. Vercel republica sozinho (~1 min). Ctrl+F5 no site.
- O `.vercelignore` impede que `supabase/`, `docs/`, `tools/` e `exemplos/` sejam publicados no site.
- Banco novo do zero: rodar `supabase/candidus_completo.sql` no SQL Editor; criar usuário no Auth;
  `update public.profiles set role='administrador' where email='SEU_EMAIL';`

## Convenção importante (lição aprendida)
Ao alterar uma função SQL **mudando os parâmetros**, o `create or replace` cria uma VERSÃO
PARALELA (overload) e o PostgREST fica ambíguo → erro "could not choose function".
Sempre que mudar assinatura de função, **dropar as versões antigas** (ver `candidus_fix_funcoes.sql`).

## MÓDULOS JÁ FEITOS E FUNCIONANDO (testados)
**Base:** login/auth, multiempresa+RLS, dashboard (consolidado por empresa + detalhe por empresa),
favoritos, auditoria, modo noite, logo Candidus.
**Cadastros:** clientes, fornecedores, categorias (hierárquicas), centros de custo,
contas financeiras, empresas (com gestão de acesso de usuários).
**Financeiro:** contas a receber e a pagar (títulos agrupados, parcelamento, baixa total/parcial,
**paginação + busca no servidor**, **trava de duplicidade**), **juros/multa/desconto na baixa**,
**estorno**, **baixa em lote**, **lançamentos recorrentes** (geram sozinho), **cartão de crédito**
(fatura, compra vira despesa na competência e caixa só na fatura), fluxo de caixa
(realizado/previsto, mensal com detalhe diário), **importação de extrato OFX/CSV** (com dedup),
**conciliação** (sugestão por valor/data/nome com nível de confiança, conciliar/escolher/desfazer,
**criar lançamento a partir do extrato**, marcar **transferência**, **conciliação 1↔N**: 1 movimento ↔ várias
contas e vários movimentos ↔ 1 conta, com sugestão automática de combinação e diferença tratada como
juros/multa, desconto ou baixa parcial, **regras automáticas** (descrição contém X → lança na categoria Y
e concilia, ou marca transferência; manual ou sozinho ao importar extrato), **lançamento em lote**
(grade + colar do Excel, tudo-ou-nada, checa duplicidade) — tudo sem duplicar caixa).
**BPO:** pendências (com automação de geração), tarefas (checklist + recorrência), documentos
(upload no Storage, bucket privado isolado por empresa).
**Controladoria:** DRE gerencial (por competência, mês atual/anterior/variação/acumulado,
consolidada, com mapeamento categoria→linha), orçamento (grade por categoria×mês),
realizado×orçado, indicadores (12, com metas).

## ONDE PARAMOS
Seguindo o "prompt mestre" do usuário (roadmap de 6 fases):
- **Fase 1 do roadmap (estabilização): CONCLUÍDA** — dashboard por empresa, paginação+busca,
  trava de duplicidade.
- **Fase 3 do roadmap (controladoria avançada): EM ANDAMENTO** — feito: DRE com 4 visões (mês × anterior,
  mês a mês, trimestral, ano × ano até o mês), AV% e AH%, detalhamento por categoria (clique na linha),
  exportar CSV pro Excel. `dre_realizado()` soma no banco (fim do limite de 1.000 linhas), corrige o sinal
  do resultado financeiro e leva juros/multa/desconto das baixas pra DRE. Realizado×Orçado e Indicadores
  usam a mesma função (`candidus_controladoria.sql`).
  **Indicadores** refeitos (pedido do Renan): 18 KPIs em 4 grupos (resultado; margens e equilíbrio;
  caixa e liquidez; prazos e risco) com fórmula no ⓘ, metas, e 2 gráficos SVG próprios (receita líquida ×
  lucro × margem; entradas × saídas × saldo). Novos: margem bruta/operacional, crescimento (mesmo recorte
  do ano anterior), ponto de equilíbrio estimado, liquidez corrente, fôlego de caixa.
  **Fim do limite de 1.000 linhas** também no Dashboard (consolidado e por empresa) e no Fluxo de caixa:
  `resumo_financeiro()`, `fluxo_mensal()`, `contar_titulos_receber()` (`candidus_indicadores.sql`).
  No Fluxo, o detalhe do mês carrega só quando abre (até 1.000 por tipo; totais sempre completos).
  **Gestão de custos** (`candidus_custos.sql`): centro de custo padrão na categoria (preenche sozinho nos
  6 formulários + lote, via MutationObserver no modalRoot; respeita escolha manual), rateio por título
  (`rateio_centro_custo` + `salvar_rateio`, soma 100%), tela "Custos e centros de custo" (por CC com
  receitas/despesas/resultado e mês a mês; por categoria agrupada pela categoria-pai, filtro por CC; CSV).
  `custos_por_cc()` aplica o rateio. Conceito: categoria = o quê (natureza; pai agrupa),
  centro de custo = onde/quem; cada lançamento tem os dois.
  **Custo fixo × variável** (`candidus_fixo_variavel.sql`): `categories.comportamento` (fixo|variavel, só
  despesa, filha em branco herda do pai), tela "Fixo × variável" em Categorias (classifica em massa via
  `salvar_comportamento_categorias`), `dre_realizado` RECRIADA com coluna `comportamento` (mesmos
  parâmetros). Indicadores: margem de contribuição R$/%, custos fixos, ponto de equilíbrio exato
  (estimado só se houver categoria sem classificação: custo→variável, despesa→fixo), margem de segurança,
  quadro "receita → variáveis → MC → fixos → resultado".
  Ajustes: DRE separa aviso "categoria sem mapeamento" de "lançamento sem categoria" (este com
  "Ver e classificar": lista os títulos do período e grava a categoria na hora); checkbox/radio com
  estilo próprio (não herdam mais o visual de caixa de texto dos filtros).
- **Fase 2 do roadmap (operação financeira): CONCLUÍDA** — feitos: juros/multa/desconto,
  estorno, baixa em lote, recorrentes, melhorias de conciliação (criar lançamento + transferência),
  **conciliação 1↔N** (`candidus_conciliacao_multi.sql`), **regras automáticas de conciliação**
  (`candidus_regras_conciliacao.sql`), **lançamento em lote** (`candidus_lancamento_lote.sql`).
  Testados no Postgres + PostgREST.

## PRÓXIMOS PASSOS SUGERIDOS (ainda não feitos)
- Conciliação: "desfazer transferência" (hoje marcar transferência não tem volta pela tela).
- **Segurança:** `gerar_pendencias_automaticas` é `security definer` e não chama
  `has_company_access`/`is_admin`; chamada sem `p_company` gera pendências em **todas** as empresas
  (só devolve contagem, não vaza dados). Achado na revisão de 17/10/2026, ainda não corrigido.
- **Controladoria avançada:** DRE trimestral/anual, análise horizontal/vertical,
  exportação PDF/Excel.
- **Gestão de custos:** fixos/variáveis/diretos/indiretos, rateio, margem de contribuição,
  ponto de equilíbrio.
- **Fluxo projetado** + cenários (conservador/base/otimista) + projeções 7/15/30/60/90 dias.
- **Fechamento mensal** (checklist + trava de período).
- **Relatórios gerenciais em PDF** (pra enviar ao cliente) — "Fase 4" combinada.
- **Módulo de produtividade/rentabilidade do BPO** (contratos por cliente, horas, margem).
- **Automações/alertas** (saldo baixo, vencimentos, anomalias) e **Candidus IA** (dá pra usar API
  grátis tipo Gemini/Groq ou deixar por último).

## ITENS COM CUSTO — DEIXAR PRO FINAL (decisão do Renan)
- **Integração bancária / DDA** ("igual Conta Azul"): puxar boletos do DDA como contas a pagar e
  reconhecer automaticamente quando a conta é paga (extrato via API). Exige backend com segredo
  (Supabase Edge Functions) + API de cada banco ou integrador de Open Finance (custo por conexão).
  Antes de começar: levantar quais bancos os clientes do BPO usam.
- **Candidus IA**, se não der pra usar API gratuita.

## COMO A CONCILIAÇÃO FUNCIONA (desde o bloco 1↔N)
- `bank_transactions.conciliado` (boolean) é **derivado por trigger**: true se tem vínculo direto
  (`receivable_installment_id`/`payable_installment_id`, usado pela baixa manual e conciliações antigas)
  **ou** itens em `conciliacao_itens`. O front filtra "a conciliar" por `conciliado=false`.
- `conciliacao_itens`: quanto de cada movimento foi pra cada parcela (exato, pra desfazer certo).
  FK das parcelas é `on delete restrict`.
- Regra: soma(itens) + juros + multa − desconto = valor do movimento. Juros/multa/desconto ficam no movimento.
- Funções: `conciliar_movimento_multi` (1→N), `conciliar_varios_movimentos` (N→1),
  `conciliar_movimento` (1↔1, agora excedente vira juros), `desconciliar_movimento`, `estornar_baixa`,
  helper `_aplicar_parcela`.
- **Regras** (`conciliation_rules`): texto normalizado (sem acento/maiúscula, `_norm_txt`), tipo
  entrada/saída/ambos (ambos só p/ transferência), faixa de valor opcional, prioridade (menor ganha).
  `simular_regras_conciliacao` (só lê) e `aplicar_regras_conciliacao` (cada movimento numa subtransação:
  erro numa regra não trava as outras). `bank_transactions.regra_id` guarda quem resolveu.
  Trigger `trg_regra_valida` exige categoria do tipo certo e da mesma empresa.
  Desfazer conciliação de movimento lançado por regra deixa a conta criada em aberto.

## MÉTODO DE TRABALHO (importante manter)
- Antes de entregar JS: `node tools/verificar.mjs` — roda `node --check` em cada arquivo **e** a
  varredura de nomes globais duplicados **entre todos os arquivos** (function/const no topo).
  Redeclarar function em JS NÃO dá erro — a última ganha e quebra a antiga em silêncio (quase
  aconteceu com `parseValorBR` da importação CSV). Com vários arquivos esse risco é maior.
- Helper usado por mais de um módulo vai pro `js/core.js`; arquivo novo de módulo precisa de
  `<script src>` no `index.html` antes do `js/app.js` (o verificador avisa se esquecer).
- Toda entrega termina com o passo a passo de teste ("Testa: ...").
- Teste de integração das telas: rodar o index.html real no Node (jsdom + @supabase/postgrest-js)
  contra PostgREST local com JWT de teste; confere números da tela × SQL e erros de JS.
- Entregar **incremental**, um bloco por vez, **testando no PostgreSQL** antes de entregar SQL.
- **Validar o JavaScript** (node --check) antes de entregar o index.html.
- Nunca entregar botão sem função nem dado fictício como real.
- Avisar quando um SQL mexe em função (risco de overload) e dropar versões antigas.

## ARQUIVOS DO PROJETO
- `index.html` + `css/` + `img/` + `js/` — o app (colar a anon key em `js/config.js`).
- `supabase/candidus_completo.sql` — recria o banco do ZERO (num Supabase novo). NÃO rodar no banco atual.
  Conferido em 17/10/2026: tem todas as 21 funções que o front chama, com 1 versão de cada (sem overload).
- `supabase/historico/01..17_*.sql` — SQLs por etapa, numerados na ordem em que foram rodados
  (mesma ordem das seções do completo). Testado no PostgreSQL (PGlite): 01→17 em ordem fica
  idêntico ao completo. Reexecutar 01/03/06/09 dá erro (tabela existe) e reexecutar 14 depois
  da 17 dá erro (tipo de retorno do `dre_realizado`) — rodar só o que falta.
- `supabase/diagnostico.sql` — só lê; mostra quais etapas do histórico o banco já tem e se há
  função duplicada (overload). Usar antes de atualizar um banco existente.
- `supabase/acessos_storage.sql` — seção 11 do completo (grants + bucket/policies de
  `documentos`), que não tinha arquivo próprio. Reexecutável.
- `exemplos/extrato_exemplo.ofx` — pra testar importação.
- `tools/verificar.mjs` — checagem antes de publicar.
