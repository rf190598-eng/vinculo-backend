/**
 * ⚠️ SCRIPT TEMPORÁRIO DE INVESTIGAÇÃO — APAGAR DEPOIS ⚠️
 *
 * Servidor local mínimo para o teste isolado do Card Payment Brick.
 * Serve teste-brick.html (o formulário de cartão) e recebe o token que o
 * Brick gera, testando na hora se esse token funciona dentro de um
 * /preapproval de verdade — ANTES de integrar o Brick no prototipo.html.
 *
 * Existe por causa de um relato (não oficial, não confirmado pela
 * documentação) de que token gerado pelo Brick pode falhar com
 * "Card token service not found" ao ser usado em /preapproval. Este teste
 * confirma ou descarta isso em minutos, sem mexer no app de verdade.
 *
 * COMO RODAR (no CMD, dentro da pasta do projeto vinculo-backend):
 *   1. Confirme que existe MP_TEST_PUBLIC_KEY no seu .env (veja o aviso
 *      abaixo se não tiver).
 *   2. node testar-brick-servidor.js
 *   3. Abra http://localhost:4000 no navegador.
 *   4. Preencha o cartão de teste indicado na página e envie.
 *   5. O resultado (sucesso ou erro) aparece na própria página e também
 *      no terminal.
 *
 * PRECISA de MP_TEST_ACCESS_TOKEN (já existe no .env, usado pelos outros
 * scripts de teste) e de MP_TEST_PUBLIC_KEY (nova — pegue no painel do
 * Mercado Pago: Suas integrações → sua aplicação → Credenciais de TESTE →
 * Public Key. É diferente da Public Key de produção, e é segura de colocar
 * no frontend — Public Key nunca é segredo).
 *
 * Não toca no banco do Vínculo, não mexe em nenhum usuário. Só cria (e não
 * cancela sozinho) uma assinatura de teste a mais se o teste for até o fim
 * com sucesso — se isso acontecer, lembre de cancelá-la depois com o
 * cancelar-assinatura-teste.js, do mesmo jeito que as duas anteriores.
 */

require('dotenv').config({ quiet: true });
const express = require('express');
const path = require('path');

const PORT = 4000;
const TOKEN = process.env.MP_TEST_ACCESS_TOKEN;
const PUBLIC_KEY = process.env.MP_TEST_PUBLIC_KEY;

const EMAIL_PAGADOR_PLACEHOLDER = 'test_payer@testuser.com';
const EMAIL_PAGADOR = process.env.MP_TEST_PAYER_EMAIL || EMAIL_PAGADOR_PLACEHOLDER;

// ===== TRAVA DE SEGURANÇA — mesma de criar-assinatura-teste.js =====
const CONTA_TESTE_ESPERADA = {
  id: 3503612681,
  nickname: 'TESTUSER6927469289370334486'
};

// Plano mensal, só para este teste — o valor real por plano é decidido no
// pagamentoController.js de verdade, isto aqui é só para confirmar o
// mecanismo de token.
const VALOR_TESTE = 24.90;

let contaVerificada = false;

async function chamarMP(metodo, caminho, corpo) {
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

async function verificarContaDeTeste() {
  const conta = await chamarMP('GET', '/users/me');
  if (!conta.ok) {
    throw new Error('Não consegui identificar a conta do token (HTTP ' + conta.status + '): ' +
      JSON.stringify(conta.dados));
  }
  if (conta.dados.id !== CONTA_TESTE_ESPERADA.id) {
    throw new Error('ESTE TOKEN NÃO É O DA CONTA DE TESTE. esperado id ' +
      CONTA_TESTE_ESPERADA.id + ', recebido id ' + conta.dados.id +
      '. Abortando — confira MP_TEST_ACCESS_TOKEN no .env.');
  }
  console.log('    conta de teste confirmada:', conta.dados.nickname, '(id ' + conta.dados.id + ')');
  contaVerificada = true;
}

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'teste-brick.html'));
});

app.get('/config', (req, res) => {
  res.json({ publicKey: PUBLIC_KEY || null });
});

app.post('/testar-token', async (req, res) => {
  const { card_token_id } = req.body || {};
  console.log('\n[testar-token] recebido do Brick:', card_token_id);

  if (!card_token_id) {
    return res.status(400).json({ ok: false, etapa: 'validacao', erro: 'card_token_id ausente no corpo.' });
  }

  try {
    if (!contaVerificada) await verificarContaDeTeste();
  } catch (erro) {
    console.error('[testar-token] TRAVA DE SEGURANÇA:', erro.message);
    return res.status(500).json({ ok: false, etapa: 'trava_de_seguranca', erro: erro.message });
  }

  const agora = new Date();
  const daquiUmAno = new Date(agora.getTime() + 365 * 24 * 60 * 60 * 1000);

  const assinatura = await chamarMP('POST', '/preapproval', {
    reason: 'TESTE BRICK — Vínculo Premium Mensal',
    external_reference: 'TESTE-BRICK-' + agora.getTime(),
    payer_email: EMAIL_PAGADOR,
    card_token_id,
    back_url: 'https://app.vinculoapp.com.br/prototipo',
    status: 'authorized',
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      start_date: agora.toISOString(),
      end_date: daquiUmAno.toISOString(),
      transaction_amount: VALOR_TESTE,
      currency_id: 'BRL'
    }
  });

  if (!assinatura.ok) {
    console.error('[testar-token] /preapproval falhou:', JSON.stringify(assinatura.dados));
    return res.json({
      ok: false,
      etapa: 'preapproval',
      http_status: assinatura.status,
      resposta_mercadopago: assinatura.dados
    });
  }

  console.log('[testar-token] ✅ /preapproval aceitou o token do Brick. preapproval_id:', assinatura.dados.id);
  console.log('    LEMBRE DE CANCELAR essa assinatura de teste depois (cancelar-assinatura-teste.js).');

  res.json({
    ok: true,
    etapa: 'preapproval',
    preapproval_id: assinatura.dados.id,
    status: assinatura.dados.status,
    mensagem: 'Token do Brick funcionou dentro do /preapproval. Não esqueça de cancelar essa assinatura de teste depois.'
  });
});

app.listen(PORT, () => {
  console.log('\n=== Teste do Card Payment Brick ===\n');
  if (!TOKEN) {
    console.warn('⚠️  MP_TEST_ACCESS_TOKEN não está no .env — a chamada ao /preapproval vai falhar.');
  }
  if (!PUBLIC_KEY) {
    console.warn('⚠️  MP_TEST_PUBLIC_KEY não está no .env — o Brick não vai carregar até você adicionar.');
    console.warn('    Pegue em: painel Mercado Pago → Suas integrações → sua aplicação →');
    console.warn('    Credenciais de TESTE → Public Key. Adicione no .env:');
    console.warn('        MP_TEST_PUBLIC_KEY=TEST-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx\n');
  }
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  console.log('Abra esse endereço no navegador para testar.\n');
});
