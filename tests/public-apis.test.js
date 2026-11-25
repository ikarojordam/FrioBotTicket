import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyPublicQuery,publicApiAnswer} from '../src/public-apis.js';
const accepts = [
 ['qual o endereço do CEP 01001-000?', 'cep'],
 ['qual é o DDD 79?', 'ddd'],
 ['feriados 2027', 'holidays'],
 ['banco 001', 'bank'],
 ['municípios do estado de SE', 'cities'],
 ['cotação USD para BRL', 'fx'],
 ['npm discord.js', 'npm'],
 ['pypi requests', 'pypi'],
 ['repositório no github discordjs/discord.js', 'github'],
 ['livro Dom Casmurro', 'book'],
 ['o que é JavaScript?', 'wiki'],
 ];
for(const [q,kind] of accepts)test(`roteia ${kind}`,()=>assert.equal(identifyPublicQuery(q)?.kind,kind));
for(const q of ['Meu token é xxxxxx no npm discord.js','Qual o pedido #12345?','Como configurar o bot?','Meu CPF 12345678900 é válido?','https://localhost/admin'])test('não envia conversas pessoais ou dúvidas não relacionadas à APIs',()=>assert.equal(identifyPublicQuery(q),null));
test('resposta mockada sem chamadas reais',async()=>{
 const old=globalThis.fetch;
 globalThis.fetch=async url=>{assert.equal(new URL(url).hostname,'viacep.com.br');return new Response(JSON.stringify({logradouro:'Praça da Sé',bairro:'Sé',localidade:'São Paulo',uf:'SP'}),{status:200,headers:{'content-type':'application/json'}});};
 try{const result=await publicApiAnswer('g1','u1','cep 01001000');assert.equal(result.source,'ViaCEP');assert.match(result.answer,/São Paulo/);}finally{globalThis.fetch=old;}
});
