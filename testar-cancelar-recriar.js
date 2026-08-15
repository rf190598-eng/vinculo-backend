/**
 * ⚠️ SCRIPT TEMPORÁRIO DE INVESTIGAÇÃO — APAGAR DEPOIS ⚠️
 *
 * Testa, contra a conta de TESTE do Mercado Pago, a lógica nova adicionada
 * ao criarAssinaturaCartao: se o usuário já tem uma assinatura de cartão
 * ativa e assina de novo (troca de cartão, clique duplo), a assinatura
 * antiga precisa ser cancelada ANTES de criar a nova — senão as duas
 * cobrariam em paralelo.
 *
 * Este script reproduz exatamente essas chamadas HTTP (GET status atual →
 * PUT cancelled se não estiver cancelada → POST da nova assinatura), usando
 * MP_TEST_ACCESS_TOKEN. Não toca no banco do Vínculo, não mexe em nenhum
 * usuário — só cria/cancela assinaturas de teste.
 *
 * COMO RODAR (no CMD, dentro da pasta do projeto):
 *     node testar-cancelar-recriar.js
 *
 * No final ele cria DUAS assinaturas de teste (A, que fica cancelada no
 * próprio teste, e B, que fica AUTHORIZED) — adicione o id de B no
 * cancelar-assinatura-teste.js depois de conferir o resultado.
 */

require('dotenv').config({ quiet: true });

const TOKEN = process.env.MP_TEST_ACCESS_TOKEN;
const EMAIL_PAGADOR = process.env.MP_TEST_PAYER_EMAIL || 'test_payer@testuser.com';
const CONTA_TESTE_ESPERADA = { id: 3503612681, nickname: 'TESTUSER6927469289370334486' };

const CARTAO_TESTE = {
  card_number: '5480832801033311',
  expiration_month: 11,
  expiration_year: 2030,
  security_code: '123',
  cardholder: { name: 'APRO', identification: { type: 'CPF', number: '12345678909' } }
};

async function chamar(metodo, caminho, corpo) {
  const resposta = await fetch(`https://api.mercadopago.com${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  const dados = await resposta.json().catch(() => null);
  return { ok: resposta.ok, status: resposta.status, dados };
}

async function criarAssinaturaDeTeste(externalRef) {
  const tokenCartao = await chamar('POST', '/v1/card_tokens', CARTAO_TESTE);
  if (!tokenCartao.ok) throw new Error('Falha ao tokenizar cartão: ' + JSON.stringify(tokenCartao.dados));

  const agora = new Date();
  const daquiUmAno = new Date(agora.getTime() + 365 * 24 * 60 * 60 * 1000);

  const assinatura = await chamar('POST', '/preapproval', {
    reason: 'TESTE cancelar-recriar',
    external_reference: externalRef,
    payer_email: EMAIL_PAGADOR,
    card_token_id: tokenCartao.dados.id,
    back_url: 'https://app.vinculoapp.com.br/prototipo',
    status: 'authorized',
    auto_recurring: {
      frequency: 1, frequency_type: 'months',
      start_date: agora.toISOString(), end_date: daquiUmAno.toISOString(),
      transaction_amount: 24.90, currency_id: 'BRL'
    }
  });
  if (!assinatura.ok) throw new Error('Falha ao criar /preapproval: ' + JSON.stringify(assinatura.dados));
  return assinatura.dados.id;
}

// Reproduz exatamente a lógica nova de criarAssinaturaCartao: se já existe
// assinatura, verifica status, cancela se não estiver cancelled, só então
// segue para criar a nova.
async function cancelarSeNecessario(idExistente) {
  const atual = await chamar('GET', '/preapproval/' + idExistente);
  if (!atual.ok) throw new Error('Não consegui ler a assinatura existente: ' + JSON.stringify(atual.dados));

  if (atual.dados.status !== 'cancelled') {
    const cancelamento = await chamar('PUT', '/preapproval/' + idExistente, { status: 'cancelled' });
    if (!cancelamento.ok) throw new Error('Falha ao cancelar: ' + JSON.stringify(cancelamento.dados));
    console.log(`    assinatura antiga ${idExistente} cancelada (era "${atual.dados.status}").`);
  } else {
    console.log(`    assinatura antiga ${idExistente} já estava cancelada — pulei o PUT.`);
  }
}

(async () => {
  if (!TOKEN) { console.error('\n❌ MP_TEST_ACCESS_TOKEN ausente no .env.\n'); process.exit(1); }

  console.log('0/4 · Verificando conta...');
  const conta = await chamar('GET', '/users/me');
  if (!conta.ok || conta.dados.id !== CONTA_TESTE_ESPERADA.id) {
    console.error('\n❌ TOKEN NÃO É O DA CONTA DE TESTE ESPERADA. Abortando.', JSON.stringify(conta.dados), '\n');
    process.exit(1);
  }
  console.log('    conta confirmada:', conta.dados.nickname);

  console.log('\n1/4 · Criando assinatura A (simula usuário assinando pela 1ª vez)...');
  const idA = await criarAssinaturaDeTeste('cartao:USUARIO-FAKE-TESTE:mensal');
  console.log('    assinatura A criada:', idA);

  console.log('\n2/4 · Simulando usuário tentando assinar de novo (troca de cartão)...');
  console.log('    lógica nova: usuario.mercadopago_subscription_id =', idA, '(já existe)');
  await cancelarSeNecessario(idA);

  console.log('\n3/4 · Criando assinatura B (a nova, depois de cancelar a A)...');
  const idB = await criarAssinaturaDeTeste('cartao:USUARIO-FAKE-TESTE:mensal');
  console.log('    assinatura B criada:', idB);

  console.log('\n4/4 · Conferindo o resultado final...');
  const statusA = await chamar('GET', '/preapproval/' + idA);
  const statusB = await chamar('GET', '/preapproval/' + idB);
  console.log('    A (' + idA + '):', statusA.dados.status, statusA.dados.status === 'cancelled' ? '✅' : '❌ ESPERAVA cancelled');
  console.log('    B (' + idB + '):', statusB.dados.status, statusB.dados.status === 'authorized' ? '✅' : '❌ ESPERAVA authorized');

  console.log('\n2ª rodada (idempotência): chamando cancelarSeNecessario em A de novo (já cancelada)...');
  await cancelarSeNecessario(idA); // deve pular o PUT, não dar erro

  console.log('\nIDs de teste criados nesta rodada — adicionar ao cancelar-assinatura-teste.js:');
  console.log('  ', idA, '(já deve estar cancelled)');
  console.log('  ', idB, '(ainda AUTHORIZED — precisa cancelar)');
})().catch(e => { console.error('\n❌ TESTE FALHOU:', e.message); process.exit(1); });
