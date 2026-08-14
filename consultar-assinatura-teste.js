/**
 * ⚠️ SCRIPT TEMPORÁRIO DE INVESTIGAÇÃO — APAGAR DEPOIS ⚠️
 *
 * SOMENTE LEITURA. Consulta o estado atual das assinaturas de teste e mostra
 * se alguma cobrança já foi processada, sem depender de webhook nenhum.
 *
 * Serve para responder: "a cobrança aconteceu de verdade?" — olhando
 * summarized.charged_quantity e summarized.last_charged_date direto na fonte.
 *
 * COMO RODAR (CMD, na pasta do projeto):
 *     node consultar-assinatura-teste.js
 *
 * Pode rodar quantas vezes quiser: não cria, não altera e não cobra nada.
 */

require('dotenv').config({ quiet: true });

const TOKEN = process.env.MP_TEST_ACCESS_TOKEN;

// As duas assinaturas de teste criadas em 14/08/2026.
const ASSINATURAS = [
  '8bbfe98776b549b59d9ae44635b53ed6',
  'bf551512f10245618b8f34be7601d1a5'
];

const reais = (v) => (v === null || v === undefined)
  ? '—'
  : 'R$ ' + Number(v).toFixed(2).replace('.', ',');

const data = (v) => v ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '— (nunca)';

(async () => {
  if (!TOKEN) {
    console.error('\n❌ MP_TEST_ACCESS_TOKEN não está no .env.\n');
    process.exit(1);
  }

  for (const id of ASSINATURAS) {
    console.log('\n' + '='.repeat(64));
    console.log('assinatura ' + id);
    console.log('='.repeat(64));

    let resposta;
    try {
      resposta = await fetch('https://api.mercadopago.com/preapproval/' + id, {
        headers: { Authorization: 'Bearer ' + TOKEN }
      });
    } catch (erro) {
      console.log('  erro de rede:', erro.message);
      continue;
    }

    const dados = await resposta.json().catch(() => null);
    if (!resposta.ok) {
      console.log('  HTTP ' + resposta.status + ':', JSON.stringify(dados));
      continue;
    }

    const s = dados.summarized || {};
    console.log('  status ................:', dados.status);
    console.log('  criada em .............:', data(dados.date_created));
    console.log('  next_payment_date .....:', data(dados.next_payment_date));
    console.log('  ---');
    console.log('  COBRANÇAS JÁ FEITAS ...:', s.charged_quantity === null || s.charged_quantity === undefined
      ? '0 (nenhuma ainda)'
      : s.charged_quantity);
    console.log('  valor já cobrado ......:', reais(s.charged_amount));
    console.log('  última cobrança em ....:', data(s.last_charged_date));
    console.log('  último valor cobrado ..:', reais(s.last_charged_amount));
    console.log('  ---');
    console.log('  parcelas pendentes ....:', s.pending_charge_quantity ?? '—');
    console.log('  valor pendente ........:', reais(s.pending_charge_amount));
  }

  console.log('\n' + '-'.repeat(64));
  console.log('Se "COBRANÇAS JÁ FEITAS" continuar em 0, a cobrança ainda não');
  console.log('rodou — não adianta procurar webhook de pagamento.');
  console.log('Se passou de 0, a cobrança ACONTECEU: aí a pergunta vira qual');
  console.log('tópico deveria ter avisado, e por que não chegou.\n');
})();
