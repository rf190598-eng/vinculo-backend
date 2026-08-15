/**
 * ⚠️ SCRIPT TEMPORÁRIO DE INVESTIGAÇÃO — APAGAR DEPOIS ⚠️
 *
 * Cancela as duas assinaturas de teste criadas para a investigação da
 * Fatia 1 (cartão recorrente), para elas pararem de cobrar todo mês.
 *
 * Faz PUT /preapproval/{id} com {"status":"cancelled"} para cada uma.
 * Não toca no banco do Vínculo, não mexe em nenhum usuário, não interfere
 * no Pix.
 *
 * COMO RODAR (no CMD, dentro da pasta do projeto):
 *     node cancelar-assinatura-teste.js
 *
 * PRECISA de MP_TEST_ACCESS_TOKEN no .env — a credencial de TESTE, não a de
 * produção. Com token de produção isto tentaria cancelar (ou falharia ao
 * tentar achar) uma assinatura de produção.
 */

require('dotenv').config({ quiet: true });

const TOKEN = process.env.MP_TEST_ACCESS_TOKEN;

// Assinaturas de teste criadas ao longo da investigação do cartão recorrente.
const ASSINATURAS = [
  '8bbfe98776b549b59d9ae44635b53ed6', // 14/08/2026 — criar-assinatura-teste.js
  'bf551512f10245618b8f34be7601d1a5', // 14/08/2026 — criar-assinatura-teste.js
  'e2c1da5d960a4aa3a6129cd42f1cd849', // 17/08/2026 — teste do Card Payment Brick
  '1fff8e67646941f9be0ebaebe3ffbcb8', // 17/08/2026 — testar-cancelar-recriar.js (A, já cancelada pelo próprio teste)
  '467077a5397047b89a95d564accfc12e'  // 17/08/2026 — testar-cancelar-recriar.js (B, ainda authorized)
];

// ===== TRAVA DE SEGURANÇA =====
// Mesma trava usada em criar-assinatura-teste.js: desde nov/2025 o token de
// TESTE também começa com "APP_USR", igual ao de produção — não dá para
// distinguir pelo prefixo. A verificação real é de identidade, via
// GET /users/me, comparando com o id da conta de teste.
//
// Valores confirmados por Roberto no painel do Mercado Pago em 13/08/2026,
// batendo com o retorno de /users/me.
const CONTA_TESTE_ESPERADA = {
  id: 3503612681,
  nickname: 'TESTUSER6927469289370334486'
};

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

  // ===== TRAVA: de qual conta é este token? =====
  console.log('0/2 · Verificando a qual conta o token pertence...');
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
      '   Abortando. Se este for o token de produção, rodar o script mexeria\n' +
      '   numa assinatura de produção. Confira MP_TEST_ACCESS_TOKEN no .env.');
  }
  console.log('    conta confirmada:', conta.dados.nickname, '(id ' + conta.dados.id + ')');

  console.log('\n1/2 · Cancelando as assinaturas de teste...\n');

  let algumaFalhou = false;

  for (const id of ASSINATURAS) {
    console.log('  → ' + id);

    // Consulta o estado atual antes de cancelar, só para o log ficar completo
    // (não é uma segunda trava, é conveniência informativa).
    const antes = await chamar('GET', '/preapproval/' + id);
    if (antes.ok) {
      console.log('    status atual ......:', antes.dados.status);
    }

    if (antes.ok && antes.dados.status === 'cancelled') {
      console.log('    já estava cancelada — nada a fazer.\n');
      continue;
    }

    const resultado = await chamar('PUT', '/preapproval/' + id, { status: 'cancelled' });

    if (!resultado.ok) {
      algumaFalhou = true;
      console.log('    ❌ falhou (HTTP ' + resultado.status + '):', JSON.stringify(resultado.dados));
      console.log('');
      continue;
    }

    console.log('    ✅ cancelada. novo status:', resultado.dados.status);
    console.log('');
  }

  console.log('2/2 · Conferindo o resultado final...\n');
  for (const id of ASSINATURAS) {
    const depois = await chamar('GET', '/preapproval/' + id);
    if (depois.ok) {
      console.log('  ' + id + ' → status: ' + depois.dados.status);
    } else {
      console.log('  ' + id + ' → não consegui reler (HTTP ' + depois.status + ')');
    }
  }

  if (algumaFalhou) {
    console.log('\n⚠️  Pelo menos uma assinatura NÃO foi cancelada. Veja os erros acima');
    console.log('   e rode o script de novo — ele é seguro para rodar mais de uma vez');
    console.log('   (assinatura já cancelada é só pulada).\n');
    process.exit(1);
  }

  console.log('\n✅ Todas as assinaturas de teste da lista estão canceladas. Não vão mais cobrar.\n');
})();
