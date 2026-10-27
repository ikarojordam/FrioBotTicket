# FRIO TICKETS v2.0

**Desenvolvido por FrioBots • FrioStore**

Bot Discord de tickets com menus, formulários, departamentos, IA Gemini, Supabase, logs, transcrições, avaliação e painel de configuração.

## Instalação na Discloud
1. Crie um bot no Discord Developer Portal e habilite **Message Content Intent**.
2. Convide o bot com os escopos `bot` e `applications.commands`. Permissões: gerenciar canais, ver canais, enviar mensagens, ler histórico, anexar arquivos e usar comandos.
3. No Supabase > SQL Editor, execute `sql/001_legacy_v1.sql` e depois `sql/002_upgrade_v2.sql` em projeto novo. Em projeto já instalado na v1, execute **apenas** `sql/002_upgrade_v2.sql`.
4. Configure as variáveis indicadas em `.env.example` no ambiente privado da hospedagem. Nunca publique chaves reais.
5. Envie o conteúdo do ZIP à Discloud e inicie o bot. O comando de início é `node src/index.js`.
6. Aguarde o registro global dos comandos (pode levar alguns minutos), use `/ticket config`, crie ao menos um departamento e publique o painel.

## Variáveis
- `DISCORD_TOKEN`: token do bot.
- `DISCORD_CLIENT_ID`: ID da aplicação.
- `DEV_IDS`: IDs Discord autorizados para `/dev ticket`, separados por vírgula.
- `SUPABASE_URL`: URL HTTPS do projeto.
- `SUPABASE_SERVICE_ROLE_KEY`: chave privada service role. **Somente no servidor**.
- `GEMINI_API_KEY`: chave da API Gemini (opcional; sem ela a IA não responde).
- `GEMINI_MODEL`: modelo Gemini, padrão `gemini-2.5-flash`.
- `BRAND_NAME`, `BRAND_SIGNATURE`: identidade visual e assinatura.
- `BRAND_IMAGE_URL`: URL HTTPS pública de banner ou GIF animado para embeds.
- `REGISTER_COMMANDS`: `true` registra comandos no início.
- `AI_TIMEOUT_MS`: limite de tempo por chamada Gemini.

## Comandos
- `/ticket config`: painel de administração com menus.
- `/ticket painel`: publicar painel de abertura no canal atual.
- `/ticket status`: estatísticas resumidas.
- `/ticket adicionar`, `/ticket remover`: permissões no ticket.
- `/ticket bloquear`, `/ticket desbloquear`: blacklist.
- `/dev ticket`: diagnóstico restrito aos DEV_IDS.

## Recursos e limitações
- Até 25 departamentos por painel (limite do menu Discord).
- Configurações persistentes no Supabase; cache de 20 segundos.
- Cada ticket tem formulário, canal privado, botão assumir, prioridade e encerramento com motivo.
- Transcrição em texto até 500 mensagens por ticket; cópia no Supabase e opcionalmente no canal de logs.
- Avaliação de 1 a 5 estrelas enviada por DM se permitida.
- Avisos de inatividade (não fecha tickets automaticamente).
- IA responde somente se habilitada globalmente **e** no departamento. A configuração de IA por departamento pode ser ajustada pelo SQL (`ticket_departments.ai_enabled=true`); ainda não há botão dedicado.
- Painéis existentes não são atualizados retroativamente ao alterar a aparência ou departamentos: publique novo painel.
- Imagem recebida é JPEG estático, disponível em `assets/frio-background.jpg`. Para GIF animado, hospede um GIF real e configure `BRAND_IMAGE_URL`.
- Interface usa embeds e componentes clássicos da API Discord; **Components V2 containers ainda não foram implementados**.
- Não há testes de integração com tokens reais. Faça teste em servidor privado antes de produção.

## Segurança e desempenho
- Banco acessado apenas pelo backend com service role; tabelas com RLS habilitado.
- Permissões verificadas no servidor antes de operações administrativas.
- Limite de tickets por usuário, blacklist, bloqueio de abertura duplicada por processo e cooldown de IA.
- Cache de configurações e consultas com filtros e índices.
- Em múltiplas instâncias, o bloqueio de abertura é local ao processo: use uma única instância ou implemente trava distribuída.

## SQL
`sql/001_legacy_v1.sql` preserva exatamente o SQL da versão anterior. `sql/002_upgrade_v2.sql` adiciona novas tabelas e colunas sem apagar tickets existentes.

## Assinatura
Frio Tickets • Desenvolvido por FrioBots • FrioStore.

## Atualização v3 — transcrições HTML
- SQL original preservado em `sql/001_legacy_v1.sql` e `sql/002_upgrade_v2.sql`.
- Para atualizar banco existente v2, execute `sql/003_transcripts_html_v3.sql`.
- Banco novo: execute 001, 002 e 003, nesta ordem.
- Ao fechar ticket, o bot gera HTML responsivo com mensagens, horários, avatares, anexos, imagens, vídeos, áudio e embeds. O HTML é anexado ao canal de logs configurado.
- **Configure o canal de logs** para receber o arquivo antes de o canal do ticket ser apagado.
- Imagens/anexos são referenciados por URLs originais do Discord e podem expirar ou ficar inacessíveis; não são armazenados offline.
- Conteúdo de botões e componentes interativos não é reproduzido no HTML. Mensagens anteriores ao limite configurado não são exportadas.
- Transcrições podem conter dados pessoais: restrinja acesso ao canal de logs e estabeleça uma política de retenção.
- Para desempenho, configure `TRANSCRIPT_MAX_MESSAGES` (padrão 2000) e `TRANSCRIPT_DB_MAX_BYTES` (padrão 750000). Arquivos grandes ainda são enviados ao canal de logs, mas não gravados no campo do banco.


## v3.1 — Emojis personalizados
Os emojis usados na interface estão em `src/emojis.js`. Para usar emojis externos, o bot precisa ter acesso aos emojis e a permissão **Usar Emojis Externos**. Recomenda-se adicionar o bot ao servidor onde os emojis estão hospedados. Caso os emojis não estejam disponíveis, substitua os IDs no catálogo por emojis acessíveis. Não há migração SQL nova nesta versão.


## v3.2 — Painel do desenvolvedor
Execute `/dev ticket` para editar perfil, assinatura global e banner HTTPS. Execute `sql/004_global_brand_v3_2.sql` no Supabase antes de iniciar esta versão. Em um banco novo, execute 001 → 002 → 003 → 004. Em um banco v3.1, execute apenas 004. O banner é exibido nos embeds sem imagem local, quando ativado.

## v3.3.0 — Interface reorganizada
- Central `/ticket config` com resumo do estado do servidor, áreas agrupadas e navegação de volta ao início.
- `/dev ticket` com blocos de identidade e sistema, ações de perfil, assinaturas e banner agrupadas por finalidade.
- Botões de atualização sem reiniciar o bot; atualização do cache de configuração no painel.
- Preservados emojis, SQL 001–004, transcrições HTML e integrações existentes.
- Nenhuma migração SQL nova necessária: a atualização é apenas de interface.
- A apresentação combina embeds, selects, botões e modais conforme a ação; não exige Components V2.
- Teste de sintaxe realizado; funcionamento no Discord depende das permissões e credenciais reais.
