import test from 'node:test';
import assert from 'node:assert/strict';
import { localAnswer } from '../src/local-ai.js';
const entries=[
 {question:'configurar bot',answer:'Abra /ticket config',guild_id:null,source:'seed'},
 {question:'como configurar logs',answer:'Configure canais de logs',guild_id:'1573403271047938088',source:'seed'},
 {question:'como configurar call do bot',answer:'Configure permissões de voz',guild_id:'1573403271047938088',source:'seed'},
 {question:'quanto custa o produto',answer:'Consulte a equipe da loja',guild_id:'1481000981725581423',source:'staff'},
];
test('pergunta específica não recebe a resposta genérica',()=>{
 const r=localAnswer('como configurar logs',entries,{guildId:'1573403271047938088'});
 assert.equal(r?.answer,'Configure canais de logs');
});
test('não mistura conhecimento específico de outro servidor',()=>{
 const r=localAnswer('quanto custa o produto',entries,{guildId:'1573403271047938088'});
 assert.notEqual(r?.answer,'Consulte a equipe da loja');
});
test('a pergunta curta genérica tem resposta exata',()=>{
 assert.equal(localAnswer('configurar bot',entries,{guildId:'1573403271047938088'})?.answer,'Abra /ticket config');
});
test('contexto recente orienta pergunta vaga',()=>{
 const r=localAnswer('como configurar?',entries,{guildId:'1573403271047938088',context:'preciso configurar os logs'});
 assert.equal(r?.answer,'Configure canais de logs');
});
test('negação diferente reduz confiança',()=>{
 const r=localAnswer('nao consigo configurar os logs',[{question:'consigo configurar os logs',answer:'Tudo funciona',guild_id:null}],{});
 assert.equal(r,null);
});
