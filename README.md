# Frio Tickets

**Powered by FrioMortal • FrioBots**

## Slash
`/ticket config`, `/ticket painel`, `/ticket estatisticas`, `/ticket ajuda`, `/dev ticket`.

## Prefixo (padrão `.`)
`.add @usuario`, `.rem @usuario`, `.fechar`, `.assumir`, `.renomear nome`, `.prioridade alta|normal`, `.bloquear @usuario`, `.desbloquear @usuario`.

## Dev
Perfil, assinaturas, banner, diagnóstico, lista de servidores, limpar cache, sincronizar comandos e emojis.

## Implantação


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

- **SQL novo:** rode `sql/007_painel_formularios_voz.sql` (ou `000_install_completo.sql`).

## 0.0.0.1 beta — /call e novo versionamento
- **/call** abre um painel V2 com **Entrar**, **Sair** e um menu para escolher a call. O bot fica na call (mudo/surdo) e **volta sozinho** depois de queda do sistema, reinício da hospedagem ou se for desconectado: a call fica salva no banco (`ticket_call_presence`), é restaurada no boot e conferida a cada 45 s. **Sair** desliga a reconexão.
- Requer Node 22.12+, permissões **Ver canal** e **Conectar** e o SQL `sql/008_call_presence.sql`.
- **Versão:** `src/version.js` (`RELEASE`). 1 → 0.0.0.1 · 9 → 0.0.0.9 · 10 → 0.0.1.0 · 20 → 0.0.2.0. Aumente `RELEASE` em 1 a cada entrega.
- `.mover @usuário #call` (vários usuários, `todos`, sem canal = sua call) e Painel Staff com Puxar/Tirar da call.

## RAM na Discloud (240 MB)
Configuração e ressalvas em `docs/RAM-240MB.md`. A meta não é garantia de consumo máximo real.

## Correções de /ticket config e cache (24/11/2026)
- Roteamento entre canais e tópicos: menu com no máximo 5 linhas, submenu dedicado para logs/cargo e navegação após salvar.
- Seleção de modos, categorias, canal-pai, cargo e logs preservada.
- Limpeza de entradas TEMPORÁRIAS vencidas a cada **10 segundos** (configurações, departamentos, cooldowns, formulários e seleções de call).
- Limite de cache Discord.js reduzido; limpeza de mensagens antigas a cada 10 segundos.
- A limpeza **não apaga** canais, permissões, tickets no Supabase, conexão de voz, nem configurações válidas.
- `RAM=240` permanece em `discloud.config`; o consumo real deve ser monitorado na Discloud.
- Execute `npm run check` antes do deploy, e teste todos os menus com a conta de administrador no Discord.
- Para usar categorias/tópicos, rode `sql/009_ticket_modes.sql` se essa migração ainda não foi aplicada.


### Logs de avaliações — atendente
O log de avaliações agora inclui **Quem assumiu**, recuperado do campo `tickets.claimed_by`. Se ninguém assumiu, mostra **Não assumido**. Nenhuma migração SQL adicional é necessária.

## Convite OAuth2 automático
Use `/convidar` para gerar um botão com o link oficial de instalação do bot em outro servidor. Administradores também encontram a opção **Link de convite** em `/dev ticket` (restrita aos desenvolvedores configurados). O link é criado com o ID da aplicação conectada, sem token ou chave sensível. Solicita `bot` e `applications.commands` e um conjunto de permissões direcionadas aos recursos de tickets, tópicos, mensagens e voz (sem Administrator). Não é necessário SQL novo.

No Developer Portal do Discord, confira se a instalação em servidores (Guild Install) está habilitada. O usuário que instalar o bot precisa das permissões de gerenciamento de servidor/aplicativos.

## Respostas automáticas locais e análise de imagens (24/11/2026)
- Ative `/ticket config → Inteligência artificial → Ativar IA`. O nome histórico do botão também ativa a FAQ **sem precisar de chave**.
- `/ticket respostas` (administrador): mostra status e como personalizar perguntas/respostas.
- 37 perguntas/intenções frequentes com variações: pedidos, suporte, pagamentos, acesso, entrega, garantia, atendimento etc. Respostas locais são modelos genéricos, sem inventar preços ou prazos.
- No campo **Instruções e conhecimento**, acrescente pares `Pergunta: ...` e `Resposta: ...` em linhas consecutivas para sobrepor as respostas padrão.


- Sem chave da API, o bot **não finge** enxergar imagens: avisa que só pode ajudar com a descrição feita pelo cliente.
- As respostas ocorrem apenas dentro do ticket do autor, quando a IA estiver habilitada e nenhum atendente tiver assumido. Cooldown de 8 segundos por ticket.
- A análise de imagem envia o conteúdo visual ao provedor de IA. Avise os usuários nas regras e evite capturas que contenham senhas, tokens ou informações confidenciais.
- Sem SQL novo. Mantidos logs, convite, controle de 240 MB e limpeza de entradas vencidas a cada 10 segundos. O consumo real pode variar, especialmente na análise de imagens.


## Atendimento local sem API de IA (24/11/2026)

- Removidas as chamadas Gemini e variáveis GEMINI_* do aplicativo em execução.
- Motor local de FAQ com 39 intenções e respostas personalizadas a partir da base de conhecimento do servidor (formato `Pergunta:` / `Resposta:`).
- No ticket aberto, responde ao cliente enquanto nenhum atendente assumiu.
- Para imagens: envia **Analisando…** e depois informa com transparência que reconheceu um anexo, mas não interpreta o conteúdo visual. Texto da mensagem pode gerar resposta local.
- `/ticket respostas` informa o status, e o teste do painel dev avalia exemplos sem internet.
- Não é um modelo de linguagem generativo treinado, mas um motor de classificação e busca de respostas de baixo consumo de RAM.
- Supabase e Discord continuam necessários para a operação normal do bot; "sem APIs" refere-se à IA.
- Não há SQL novo. O consumo total de RAM deve ser observado na Discloud.

## Aprendizado com Supabase
Execute `sql/011_ai_knowledge_learning.sql`. Veja `docs/IA-BASE-SUPABASE.md`.

## Aprendizado por servidor (loja + Frio Applications)
Consulte `docs/IA-DOIS-SERVIDORES.md`. Não mistura conhecimentos entre servidores.

## +lockall, +unlockall e resposta a menções (24/11/2026)
Execute **`sql/014_lockall_backups.sql`** antes de implantar a atualização. Leia `docs/LOCKALL-E-MENCOES.md` para permissões, limitações e teste. O comando `+lockall` restringe envio nos canais e criação de tópicos para @everyone, sem mexer em `SendMessagesInThreads`; `+unlockall` restaura o estado salvo no Supabase. Ao mencionar o bot, ele pergunta “Qual sua dúvida/problema?”.

## Consultas públicas sem chave e dicionário (nova versão)
O assistente usa uma base de conhecimento separada por servidor e, se ela não tiver resposta confiável, consulta **somente** uma fonte pública apropriada à pergunta. Consulte `docs/APIS-PUBLICAS-E-VOCABULARIO.md`.

Execute opcionalmente `sql/015_vocabulario_suporte.sql` após `011`/`013` para acrescentar definições de suporte a **FrioStore** e **Frio Applications**. Não substitui as respostas aprendidas. API pública não equivale a IA generativa. O conteúdo de imagens não é interpretado visualmente. Ative Open-Meteo somente após revisar os termos de uso comercial.


## Vocabulário expandido a partir dos chats
Execute `sql/016_vocabulario_expandido_chats.sql` após as migrações de IA. Consulte `docs/VOCABULARIO-AMPLIADO-016.md`.

## Atualização: contexto e qualidade das respostas (25/11/2026)
- Perguntas genéricas não têm mais prioridade indevida sobre perguntas específicas.
- O avaliador reclassifica os resultados do Supabase por assunto, similaridade, conhecimento do servidor e confiança.
- Mensagens recentes do cliente no mesmo ticket (máximo quatro, TTL de cinco minutos) ajudam a interpretar perguntas curtas de continuação.
- A seleção não responde quando a confiança é baixa ou quando duas respostas conflitantes estão empatadas.
- As respostas aprendidas do servidor da FrioStore não são misturadas às da Frio Applications.
- As últimas mensagens ficam apenas temporariamente em memória e são limpas a cada 10 segundos; não há armazenamento de conversas adicionais no Supabase.
- Preservadas as integrações, comandos, o período de 25 segundos e a configuração de 240 MB.
- Nenhuma migração SQL adicional é necessária, desde que `sql/013_ai_search_scalable.sql` já esteja instalada.
- Testes locais: `node --test tests/knowledge-context.test.js`.

A análise continua sendo feita por regras e sem um modelo generativo. Para dúvidas ambíguas ou desconhecidas, o bot pede esclarecimento ou encaminha à equipe.
