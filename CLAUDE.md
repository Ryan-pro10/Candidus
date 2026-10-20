# Candidus — instruções para o Claude

- Leia `docs/ESTADO-DO-PROJETO.md` antes de qualquer tarefa: módulos prontos, onde paramos, próximos passos e o método de trabalho combinado.
- Estrutura e como adicionar tela: `README.md`.
- Usuário fala português; respostas em português.

## Regras que não podem quebrar
- JS puro sem build; scripts clássicos com tudo global. A ordem dos `<script>` no `index.html` importa e `js/app.js` é sempre o último (chama `boot()`).
- Depois de qualquer mudança em JS: `node tools/verificar.mjs`. Ele precisa passar.
- Helper usado por mais de um módulo fica em `js/core.js`; não redeclare nome que já existe em outro arquivo.
- SQL: ao mudar parâmetros de função, dropar as versões antigas (overload quebra o PostgREST). Avisar o usuário quando um SQL mexe em função.
- Antes de mandar o usuário rodar SQL, peça o resultado de `supabase/diagnostico.sql` (só lê). Ao criar etapa nova, adicione a marca dela no diagnóstico.
- Mudança no banco vira arquivo novo em `supabase/historico/` (próximo número) **e** entra no `supabase/candidus_completo.sql`.
- Nunca colocar a service_role key no front. A anon key em `js/config.js` é pública (protegida por RLS).
- Toda entrega termina com o passo a passo de teste ("Testa: ...").
