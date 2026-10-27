# Frio Tickets v3.8.0

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
