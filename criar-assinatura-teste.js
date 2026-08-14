/**
 * ⚠️ SCRIPT TEMPORÁRIO DE INVESTIGAÇÃO — APAGAR DEPOIS ⚠️
 *
 * Cria UMA assinatura de teste no Mercado Pago, só para provocar os webhooks
 * de Assinatura e descobrir quais tópicos chegam e com qual payload.
 *
 * Não toca no banco do Vínculo, não mexe em nenhum usuário, não interfere no
 * Pix. É um script solto: roda, imprime os ids, e acaba.
 *
 * COMO RODAR (no CMD, dentro da pasta do projeto):
 *     node criar-assinatura-teste.js
 *
 * PRECISA de MP_TEST_ACCESS_TOKEN no .env — a credencial de TESTE, não a de
 * produção. Com token de produção isto cobraria um cartão de verdade.
 */

require('dotenv').config();

const TOKEN = process.env.MP_TEST_ACCESS_TOKEN;
const EMAIL_PAGADOR = process.env.MP_TEST_PAYER_EMAIL || 'test_payer@testuser.com';

// Cartão de teste oficial do Mercado Pago (Brasil). Titular "APRO" + CPF
// 12345678909 é o combo que força aprovação.
const CARTAO_TESTE = {
  card_number: '5031433215406351',
  expiration_month: 11,
  expiration_year: 2030,
  security_code: '123',
  cardholder: {
    name: 'APRO',
    identification: { type: 'CPF', number: '12345678909' }
  }
};

// Plano mensal do Vínculo, espelhando pagamentoController.planos.mensal.
const VALOR = 24.90;

function erroFatal(mensagem) {
  console.error('\n❌ ' + mensagem + '\n');
  process.exit(1);
}

async function chamar(metodo, caminho, corpo) {
  const resposta = await fetch(`https://api.mercadopago.com${caminho}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  const dados = await resposta.json().catch(() => null);
  return { ok: resposta.ok, status: resposta.status, dados };
}

(async () => {
  if (!TOKEN) {
    erroFatal('MP_TEST_ACCESS_TOKEN não está no .env.\n' +
      '   Pegue em: mercadopago.com.br/developers → Suas integrações →\n' +
      '   sua aplicação → Credenciais de teste → Access Token');
  }
  if (!TOKEN.startsWith('TEST-')) {
    erroFatal('O MP_TEST_ACCESS_TOKEN não começa com "TEST-".\n' +
      '   Isso parece uma credencial de PRODUÇÃO — abortando para não cobrar\n' +
      '   um cartão de verdade. Use a credencial de teste.');
  }

  console.log('1/2 · Gerando token do cartão de teste...');
  const tokenCartao = await chamar('POST', '/v1/card_tokens', CARTAO_TESTE);
  if (!tokenCartao.ok) {
    erroFatal('Falha ao tokenizar o cartão (HTTP ' + tokenCartao.status + '):\n   ' +
      JSON.stringify(tokenCartao.dados));
  }
  console.log('    token do cartão:', tokenCartao.dados.id);

  console.log('2/2 · Criando a assinatura (/preapproval)...');
  const agora = new Date();
  const daquiUmAno = new Date(agora.getTime() + 365 * 24 * 60 * 60 * 1000);

  const assinatura = await chamar('POST', '/preapproval', {
    reason: 'Vínculo Premium Mensal (TESTE)',
    external_reference: 'TESTE-WEBHOOK-' + agora.getTime(),
    payer_email: EMAIL_PAGADOR,
    card_token_id: tokenCartao.dados.id,
    back_url: 'https://app.vinculoapp.com.br/prototipo',
    status: 'authorized',
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      start_date: agora.toISOString(),
      end_date: daquiUmAno.toISOString(),
      transaction_amount: VALOR,
      currency_id: 'BRL'
    }
  });

  if (!assinatura.ok) {
    erroFatal('Falha ao criar a assinatura (HTTP ' + assinatura.status + '):\n   ' +
      JSON.stringify(assinatura.dados));
  }

  const a = assinatura.dados;
  console.log('\n✅ Assinatura de teste criada.\n');
  console.log('   preapproval_id ....:', a.id);
  console.log('   status ............:', a.status);
  console.log('   próxima cobrança ..:', a.next_payment_date);
  console.log('   external_reference :', a.external_reference);
  console.log('\n   Guarde o preapproval_id acima — é por ele que vamos');
  console.log('   identificar os eventos nos logs do Railway.');
  console.log('\n   A primeira cobrança acontece ~1h depois. Os webhooks de');
  console.log('   criação devem chegar em segundos.\n');
})();
