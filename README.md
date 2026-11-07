# Frio Tickets v4.4.0

**Powered by FrioMortal • FrioBots**

## Slash
`/ticket config`, `/ticket painel`, `/ticket estatisticas`, `/ticket ajuda`, `/dev ticket`.

## Prefixo (padrão `.`)
`.add @usuario`, `.rem @usuario`, `.fechar`, `.assumir`, `.renomear nome`, `.prioridade alta|normal`, `.bloquear @usuario`, `.desbloquear @usuario`.

## Dev
Perfil, assinaturas, banner, diagnóstico, lista de servidores, limpar cache, sincronizar comandos e emojis.

## Implantação
Use Discloud com `discloud.config` na raiz. Configure `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DEV_IDS`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Para IA: `GEMINI_API_KEY`. Para prefixo: `BOT_PREFIX=.` e ative Message Content Intent no portal do Discord.

## Banco
Todos os SQLs anteriores estão em `sql/`. Nenhum SQL novo nesta atualização.

**Atenção:** testes de sintaxe não substituem testes com Discord/Supabase reais.


## v3.9.0 — Emojis personalizados
O catálogo usa os IDs originais enviados pelo proprietário. Não há substituição automática por Unicode. Para cópias locais, configure `AUTO_SYNC_EMOJIS=true` e conceda Gerenciar Expressões.


## Desempenho v4.0
`CACHE_TTL_MS=60000` define a validade do cache; `PERF_LOG=true` habilita medição local do início das respostas. O tempo medido não é a latência de rede.


## v4.2 — resposta rápida
Os botões que consultam o banco confirmam a interação antes da consulta. O encerramento abre o modal imediatamente. Emojis originais preservados. Consulte docs/CHANGELOG-v4.2.md.


## v4.3 — Identidade visual
Somente emojis personalizados do catálogo `src/emojis.js`. Emojis externos precisam estar acessíveis ao bot; use a sincronização com a permissão Gerenciar Expressões. Não há novo SQL.


## v4.3.1 — Correções
Instalação do banco: rode só `sql/000_install_completo.sql`. Detalhes em docs/CHANGELOG-v4.3.1.md.

## v4.4.0 — Painéis, voz, formulários e IA
- **Painel Staff** (só o cargo configurado): assumir/liberar, notificar membro, transcript, adicionar/remover usuários, renomear, prioridade (baixa/normal/alta/urgente), criar/excluir canal de voz, encerrar.
- **Painel Membros**: ver status/responsável, notificar quem assumiu (ou a equipe) e encerrar.
- O canal de voz do ticket é excluído junto com o ticket.
- **Formulários**: `/ticket config → Departamentos → Gerenciar formulário` (0 a 10 perguntas).
- **IA**: responde ao autor do ticket enquanto ninguém assumir. Modelo padrão `gemini-3.8-flash` (defina `GEMINI_MODEL` para trocar). Requer `GEMINI_API_KEY` e IA ativada em `/ticket config → Inteligência artificial`.
- **SQL novo:** rode `sql/007_painel_formularios_voz.sql` (ou `000_install_completo.sql`).
