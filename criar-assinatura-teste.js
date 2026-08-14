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

// quiet: true silencia a linha "◇ injected env (N) from .env // tip: ..." que
// o dotenv imprime por padrão. A mensagem é legítima (tips promocionais
// sorteadas do próprio pacote, verificadas em 13/08/2026), mas num script que
// mexe com pagamento não deve haver ruído competindo com a saída real.
require('dotenv').config({ quiet: true });

const TOKEN = process.env.MP_TEST_ACCESS_TOKEN;

// E-mail genérico que aparece nos exemplos da documentação. NÃO corresponde a
// nenhuma conta de teste real — usá-lo é a principal suspeita por trás do
// cc_rejected_high_risk que travou o teste em 13/08/2026: o motor antifraude
// do Mercado Pago avalia o pagador, e um e-mail que não existe como comprador
// é candidato natural a "alto risco".
const EMAIL_PAGADOR_PLACEHOLDER = 'test_payer@testuser.com';
const EMAIL_PAGADOR = process.env.MP_TEST_PAYER_EMAIL || EMAIL_PAGADOR_PLACEHOLDER;
const USANDO_PLACEHOLDER = EMAIL_PAGADOR === EMAIL_PAGADOR_PLACEHOLDER;

// ===== TRAVA DE SEGURANÇA =====
// Desde nov/2025 o Mercado Pago gera as credenciais de teste automaticamente,
// e o Access Token de TESTE também começa com "APP_USR" — igual ao de
// produção. Ou seja: NÃO existe como distinguir teste de produção olhando a
// string do token. A primeira versão deste script checava o prefixo "TEST-",
// o que hoje é inútil (e trocar por "APP_USR" seria pior: aceitaria produção).
//
// A verificação real é de IDENTIDADE: perguntamos à API de qual conta o token
// é (GET /users/me) e exigimos que seja exatamente a conta de teste abaixo.
// Se alguém trocar o token pelo de produção, a conta será outra e o script
// aborta antes de tocar em qualquer cartão.
//
// Valores confirmados por Roberto no painel do Mercado Pago em 13/08/2026,
// batendo com o retorno de /users/me.
const CONTA_TESTE_ESPERADA = {
  id: 3503612681,
  nickname: 'TESTUSER6927469289370334486'
};

// Cartão de teste oficial do Mercado Pago para o BRASIL (site_id MLB).
//
// ATENÇÃO ao trocar este número: a primeira versão deste script usava
// 5031433215406351, que é o cartão de teste da Argentina. Numa conta
// brasileira ele falha com
//   {"message":"Unsupported_credit_card_for_recurring_payment",
//    "code":"Invalid_payment_method","status":400}
// — mensagem que sugere "cartão não serve para recorrência", quando na
// verdade o problema é país errado. Use só os números da tabela oficial
// de cartões de teste do Brasil.
//
// Titular "APRO" + CPF 12345678909 é o combo que força aprovação.
const CARTAO_TESTE = {
  card_number: '5480832801033311', // Mastercard crédito (Brasil)
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
  // Aviso, não bloqueio: o placeholder pode até funcionar em alguma conta, e
  // travar o script por isso seria exagero. Mas ele precisa aparecer ANTES de
  // qualquer chamada — foi justamente por passar em silêncio que ninguém
  // reparou nele até o antifraude recusar a assinatura.
  if (USANDO_PLACEHOLDER) {
    console.warn('\n⚠️  ATENÇÃO — MP_TEST_PAYER_EMAIL não está configurado.\n');
    console.warn('   Usando o e-mail genérico da documentação: ' + EMAIL_PAGADOR_PLACEHOLDER);
    console.warn('   Ele NÃO é uma conta de teste real, e é a causa mais provável de');
    console.warn('   falhar com cc_rejected_high_risk (antifraude recusando o pagador).\n');
    console.warn('   Para resolver: painel → Suas integrações → sua aplicação →');
    console.warn('   Contas de teste → + Criar conta de teste → tipo Comprador.');
    console.warn('   Depois adicione no .env:');
    console.warn('       MP_TEST_PAYER_EMAIL=test_user_XXXXXXX@testuser.com\n');
    console.warn('   Seguindo assim mesmo em 5 segundos... (Ctrl+C para cancelar)\n');
    await new Promise((r) => setTimeout(r, 5000));
  }

  // ===== TRAVA: de qual conta é este token? =====
  console.log('0/3 · Verificando a qual conta o token pertence...');
  const conta = await chamar('GET', '/users/me');
  if (!conta.ok) {
    erroFatal('Não consegui identificar a conta do token (HTTP ' + conta.status + ').\n' +
      '   Abortando por precaução — sem saber de quem é o token, não dá para\n' +
      '   garantir que é o de teste.\n   Resposta: ' + JSON.stringify(conta.dados));
  }
  if (conta.dados.id !== CONTA_TESTE_ESPERADA.id) {
    erroFatal('ESTE TOKEN NÃO É O DA CONTA DE TESTE.\n\n' +
      '   esperado : id ' + CONTA_TESTE_ESPERADA.id + ' (' + CONTA_TESTE_ESPERADA.nickname + ')\n' +
      '   recebido : id ' + conta.dados.id + ' (' + conta.dados.nickname + ')\n\n' +
      '   Abortando. Se este for o token de produção, rodar o script cobraria\n' +
      '   um cartão de verdade. Confira MP_TEST_ACCESS_TOKEN no .env.');
  }
  console.log('    conta confirmada:', conta.dados.nickname, '(id ' + conta.dados.id + ')');

  console.log('1/3 · Gerando token do cartão de teste...');
  const tokenCartao = await chamar('POST', '/v1/card_tokens', CARTAO_TESTE);
  if (!tokenCartao.ok) {
    erroFatal('Falha ao tokenizar o cartão (HTTP ' + tokenCartao.status + '):\n   ' +
      JSON.stringify(tokenCartao.dados));
  }
  console.log('    token do cartão:', tokenCartao.dados.id);

  console.log('2/3 · Criando a assinatura (/preapproval)...');
  console.log('    pagador:', EMAIL_PAGADOR + (USANDO_PLACEHOLDER ? '  ⚠️ (placeholder)' : ''));
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
