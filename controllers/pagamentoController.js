const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const { Op } = require('sequelize');
const Usuario = require('../models/Usuario');
const PagamentoAssinaturaProcessado = require('../models/PagamentoAssinaturaProcessado');
const { sincronizarIndicacaoDoUsuario } = require('./parceiroController');
const {
  enviarMensagemTemplate,
  normalizarTelefoneE164,
  validarTelefoneCelularBR
} = require('../services/whatsappService');

// Configurar Mercado Pago
const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN || 'TEST-token-aqui'
});

const planos = {
  semanal: { valor: 9.90, dias: 7, nome: 'Vínculo Premium Semanal' },
  mensal: { valor: 24.90, dias: 30, nome: 'Vínculo Premium Mensal' },
  anual: { valor: 199.90, dias: 365, nome: 'Vínculo Premium Anual' }
};

/**
 * Ativa um plano pago para o usuário e sincroniza a indicação do Programa de
 * Parceiros. Ponto único usado pelo webhook e pelo endpoint de teste, pra que
 * os dois caminhos deixem o banco no mesmo estado.
 */
async function ativarPlanoDoUsuario(usuario_id, plano) {
  const planoEscolhido = planos[plano];
  if (!usuario_id || !planoEscolhido) return null;

  const agora = new Date();
  const premium_ate = new Date(agora.getTime() + planoEscolhido.dias * 24 * 60 * 60 * 1000);

  await Usuario.update(
    {
      premium: true,
      premium_ate,
      plano_atual: plano,
      // Ciclo novo, prazo novo: o lembrete do ciclo anterior não vale mais.
      // Sem esse reset, quem renovasse nunca mais receberia lembrete.
      lembrete_renovacao_enviado_em: null
    },
    { where: { id: usuario_id } }
  );

  // A indicação nasce (ou reativa) aqui — no primeiro pagamento confirmado,
  // não na verificação de identidade.
  try {
    await sincronizarIndicacaoDoUsuario(usuario_id);
  } catch (erroIndicacao) {
    // Nunca derrubar a confirmação de pagamento por causa disso: o dinheiro
    // já entrou. O job diário reconcilia se aqui falhar.
    console.error('Falha ao sincronizar indicação após pagamento:', erroIndicacao.message);
  }

  return premium_ate;
}

/**
 * Encerra o plano pago: premium desligado, plano_atual limpo e a indicação
 * correspondente marcada como cancelada.
 */
async function encerrarPlanoDoUsuario(usuario_id) {
  await Usuario.update(
    { premium: false, plano_atual: null },
    { where: { id: usuario_id } }
  );
  try {
    await sincronizarIndicacaoDoUsuario(usuario_id);
  } catch (erroIndicacao) {
    console.error('Falha ao sincronizar indicação após fim de plano:', erroIndicacao.message);
  }
}

const criarPagamentoPix = async (req, res) => {
  try {
    const { plano, telefone } = req.body;
    const usuario_id = req.usuarioId;

    if (!planos[plano]) {
      return res.status(400).json({ erro: 'Plano inválido. Use: semanal, mensal ou anual' });
    }

    const usuario = await Usuario.findByPk(usuario_id);
    const planoEscolhido = planos[plano];

    // Telefone é obrigatório para assinar: é por ele que o lembrete de
    // renovação chega. Só é pedido de quem ainda não tem — quem já assinou
    // antes (ou já preencheu numa tentativa anterior) passa direto.
    //
    // A flag requer_telefone no erro é o que o app usa para abrir o modal de
    // telefone em vez de mostrar a mensagem de erro crua.
    if (!usuario.telefone) {
      if (!telefone) {
        return res.status(400).json({
          erro: 'Precisamos do seu telefone para avisar sobre a renovação.',
          requer_telefone: true
        });
      }
      const telefoneNormalizado = normalizarTelefoneE164(telefone);
      if (!validarTelefoneCelularBR(telefoneNormalizado)) {
        return res.status(400).json({
          erro: 'Telefone inválido. Use o formato (DD) 9XXXX-XXXX',
          requer_telefone: true
        });
      }
      await usuario.update({ telefone: telefoneNormalizado });
    }

    const payment = new Payment(client);
    const resultado = await payment.create({
      body: {
        transaction_amount: planoEscolhido.valor,
        description: planoEscolhido.nome,
        payment_method_id: 'pix',
        notification_url: 'https://vinculo-backend-production.up.railway.app/api/pagamento/webhook',
        payer: {
          email: usuario.email,
          first_name: usuario.nome
        },
        metadata: {
          usuario_id,
          plano
        }
      }
    });

    res.json({
      mensagem: 'PIX gerado com sucesso!',
      pagamento_id: resultado.id,
      status: resultado.status,
      pix_copia_cola: resultado.point_of_interaction?.transaction_data?.qr_code,
      qr_code_base64: resultado.point_of_interaction?.transaction_data?.qr_code_base64,
      valor: planoEscolhido.valor,
      plano: planoEscolhido.nome
    });

  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao gerar PIX: ' + erro.message });
  }
};

// Cartão recorrente — quantas unidades de que tipo de período cada plano
// cobra. "weeks" NÃO existe no auto_recurring do Mercado Pago (só "days" e
// "months" são aceitos), por isso semanal vira frequency:7/frequency_type:days.
const RECORRENCIA_POR_PLANO = {
  semanal: { frequency: 7, frequency_type: 'days' },
  mensal: { frequency: 1, frequency_type: 'months' },
  anual: { frequency: 12, frequency_type: 'months' }
};

const criarAssinaturaCartao = async (req, res) => {
  try {
    const { plano, card_token_id, telefone } = req.body;
    const usuario_id = req.usuarioId;

    if (!planos[plano]) {
      return res.status(400).json({ erro: 'Plano inválido. Use: semanal, mensal ou anual' });
    }
    if (!card_token_id) {
      return res.status(400).json({ erro: 'Token do cartão ausente. Tente novamente.' });
    }

    const usuario = await Usuario.findByPk(usuario_id);
    const planoEscolhido = planos[plano];

    // Mesmo requisito do Pix: telefone é obrigatório pra assinar (é por ele
    // que o lembrete de renovação chega).
    if (!usuario.telefone) {
      if (!telefone) {
        return res.status(400).json({
          erro: 'Precisamos do seu telefone para avisar sobre a renovação.',
          requer_telefone: true
        });
      }
      const telefoneNormalizado = normalizarTelefoneE164(telefone);
      if (!validarTelefoneCelularBR(telefoneNormalizado)) {
        return res.status(400).json({
          erro: 'Telefone inválido. Use o formato (DD) 9XXXX-XXXX',
          requer_telefone: true
        });
      }
      await usuario.update({ telefone: telefoneNormalizado });
    }

    // Se já existe uma assinatura de cartão ativa vinculada a este usuário,
    // cancela ANTES de criar a nova — senão as duas cobrariam em paralelo
    // (cartão trocado, clique duplo, etc). Confere o status primeiro pra não
    // mandar PUT num recurso que já está cancelado.
    if (usuario.mercadopago_subscription_id) {
      const assinaturaAtual = await fetch(
        `https://api.mercadopago.com/preapproval/${usuario.mercadopago_subscription_id}`,
        { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } }
      );
      const dadosAtual = await assinaturaAtual.json().catch(() => null);

      if (assinaturaAtual.ok && dadosAtual.status !== 'cancelled') {
        const cancelamento = await fetch(
          `https://api.mercadopago.com/preapproval/${usuario.mercadopago_subscription_id}`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: 'cancelled' })
          }
        );
        if (!cancelamento.ok) {
          const erroCancelamento = await cancelamento.json().catch(() => null);
          console.error(`[assinatura-cartao] falha ao cancelar assinatura antiga` +
            ` ${usuario.mercadopago_subscription_id} do usuario ${usuario_id}:`, JSON.stringify(erroCancelamento));
          return res.status(500).json({
            erro: 'Você já tem uma assinatura de cartão ativa e não consegui trocá-la agora. Tente novamente em alguns minutos.'
          });
        }
        console.log(`[assinatura-cartao] assinatura antiga ${usuario.mercadopago_subscription_id}` +
          ` cancelada antes de criar nova para usuario ${usuario_id}.`);
      }
    }

    const agora = new Date();
    const daquiUmAno = new Date(agora.getTime() + 365 * 24 * 60 * 60 * 1000);
    const recorrencia = RECORRENCIA_POR_PLANO[plano];

    const resposta = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        reason: planoEscolhido.nome,
        // Prefixo "cartao:" identifica esse formato pro webhook e evita
        // confundir com qualquer outro external_reference no futuro. É daqui
        // que o webhook sabe qual usuário/plano uma cobrança de ciclo
        // pertence — metadata do pagamento de assinatura NÃO tem
        // usuario_id/plano (ver bug documentado na Fatia 1).
        external_reference: `cartao:${usuario_id}:${plano}`,
        payer_email: usuario.email,
        card_token_id,
        back_url: 'https://app.vinculoapp.com.br/prototipo',
        status: 'authorized',
        auto_recurring: {
          frequency: recorrencia.frequency,
          frequency_type: recorrencia.frequency_type,
          start_date: agora.toISOString(),
          end_date: daquiUmAno.toISOString(),
          transaction_amount: planoEscolhido.valor,
          currency_id: 'BRL'
        }
      })
    });

    const dadosAssinatura = await resposta.json().catch(() => null);

    if (!resposta.ok) {
      console.error(`[assinatura-cartao] falha ao criar /preapproval para usuario ${usuario_id}:`, JSON.stringify(dadosAssinatura));
      return res.status(500).json({ erro: 'Não foi possível criar a assinatura. Tente novamente ou use o Pix.' });
    }

    // Guarda o id da assinatura — usado pelo webhook (via mercadopago_subscription_id)
    // e pra permitir cancelamento futuro pelo próprio usuário.
    await usuario.update({ mercadopago_subscription_id: dadosAssinatura.id });

    // NÃO libera premium aqui — status 'authorized' não é pagamento aprovado
    // (Fatia 1). Só o webhook, quando confirmar a cobrança de verdade, ativa.
    res.json({
      mensagem: 'Assinatura criada. Confirmando o pagamento...',
      mercadopago_subscription_id: dadosAssinatura.id,
      status: dadosAssinatura.status,
      plano: planoEscolhido.nome
    });

  } catch (erro) {
    console.error('[assinatura-cartao] erro:', erro.message);
    res.status(500).json({ erro: 'Erro ao criar assinatura: ' + erro.message });
  }
};

// ⚠️ TEMPORÁRIO — INVESTIGAÇÃO DE WEBHOOKS DE ASSINATURA ⚠️
// Remover depois que soubermos quais tópicos chegam e com qual payload.
const TOPICOS_ASSINATURA = [
  'subscription_preapproval',
  'subscription_preapproval_plan',
  'subscription_authorized_payment'
];

// Onde consultar cada tipo de recurso. O payload do webhook do Mercado Pago é
// magro de propósito (traz basicamente um id), então só ele não responde
// "esse ciclo foi aprovado?" — para isso é preciso ler o recurso.
const ENDPOINT_POR_TOPICO = {
  subscription_preapproval: 'preapproval',
  subscription_preapproval_plan: 'preapproval_plan',
  subscription_authorized_payment: 'authorized_payments'
};

/**
 * ⚠️ TEMPORÁRIO ⚠️
 * Busca o recurso citado no webhook e loga o corpo inteiro. Somente leitura:
 * não grava nada, não altera estado. Serve para descobrir qual tópico carrega
 * a confirmação de pagamento do ciclo.
 *
 * Chamada sem await de propósito — o Mercado Pago exige resposta rápida e
 * reenvia com retry se demorarmos. A investigação não pode atrasar o 200.
 */
async function investigarRecursoAssinatura(tipo, id) {
  const caminho = ENDPOINT_POR_TOPICO[tipo];
  if (!caminho || !id) return;

  // Um recurso só pode ser lido pela conta que o criou ("callerId"). Durante a
  // investigação, as assinaturas de teste nascem na conta de TESTE, mas este
  // servidor só tem o token de PRODUÇÃO — daí o
  //   {"message":"the preapprovalId is not valid for callerId","status":400}
  //
  // Então tentamos os dois, em ordem, e logamos qual funcionou. Isso é
  // artefato de teste, não de arquitetura: em produção, assinaturas reais
  // nascem com o token de produção e são lidas pelo mesmo token.
  const tentativas = [
    { rotulo: 'producao', token: process.env.MP_ACCESS_TOKEN },
    { rotulo: 'teste', token: process.env.MP_TEST_ACCESS_TOKEN }
  ].filter((t) => t.token);

  for (const tentativa of tentativas) {
    try {
      const resposta = await fetch(`https://api.mercadopago.com/${caminho}/${id}`, {
        headers: { Authorization: `Bearer ${tentativa.token}` }
      });
      const corpo = await resposta.json().catch(() => null);

      if (resposta.ok) {
        console.log(`[webhook-assinatura] RECURSO ${caminho}/${id} lido com token de ${tentativa.rotulo}:`,
          JSON.stringify(corpo));
        return;
      }

      console.log(`[webhook-assinatura] token de ${tentativa.rotulo} não serviu para ${caminho}/${id}` +
        ` (HTTP ${resposta.status}): ${JSON.stringify(corpo)}`);
    } catch (erro) {
      console.error(`[webhook-assinatura] erro de rede lendo ${caminho}/${id}` +
        ` com token de ${tentativa.rotulo}:`, erro.message);
    }
  }

  console.error(`[webhook-assinatura] NENHUM token conseguiu ler ${caminho}/${id}.`);
}

/**
 * ⚠️ TEMPORÁRIO — INVESTIGAÇÃO ⚠️
 * Tenta ler um pagamento com o token de TESTE. Devolve o pagamento ou null.
 *
 * Existe porque as cobranças das assinaturas de teste nascem na conta de
 * teste, e o token de produção não as enxerga — o Mercado Pago responde
 * "Payment not found", que parece um pagamento sumido quando na verdade é
 * falta de permissão entre contas.
 *
 * Somente leitura, nunca lança.
 */
async function lerPagamentoComTokenDeTeste(id) {
  const token = process.env.MP_TEST_ACCESS_TOKEN;
  if (!token || !id) return null;
  try {
    const resposta = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!resposta.ok) return null;
    return await resposta.json();
  } catch (erro) {
    return null;
  }
}

const webhook = async (req, res) => {
  try {
    const { type, data } = req.body;

    // ⚠️ TEMPORÁRIO — LOG DE INVESTIGAÇÃO ⚠️
    // Loga TODO evento antes de qualquer filtro. Inclui a query string porque
    // o Mercado Pago tem dois formatos de notificação: o moderno (JSON no
    // corpo, com "type") e o antigo/IPN (parâmetros ?topic=&id= na URL) — se
    // olhássemos só o corpo, poderíamos concluir que "não chegou nada".
    const topico = type || req.query.topic || req.query.type || '(sem tópico)';
    console.log(`[webhook-mp] ${new Date().toISOString()} topico=${topico}` +
      ` query=${JSON.stringify(req.query)} body=${JSON.stringify(req.body)}`);

    if (TOPICOS_ASSINATURA.includes(topico)) {
      const idRecurso = (data && data.id) || req.query.id || req.query['data.id'];
      console.log(`[webhook-assinatura] EVENTO topico=${topico} action=${req.body.action || '-'} id=${idRecurso}`);
      // Sem await: responde 200 primeiro, investiga depois.
      investigarRecursoAssinatura(topico, idRecurso);
      return res.status(200).json({ ok: true });
    }

    if (type === 'payment') {
      let pagamento;
      try {
        const payment = new Payment(client);
        pagamento = await payment.get({ id: data.id });
      } catch (erroLeitura) {
        // ⚠️ TEMPORÁRIO — INVESTIGAÇÃO ⚠️
        // Falhou com o token de produção. Antes de tratar como erro, checa se
        // não é um pagamento da conta de TESTE (cobrança de assinatura de
        // teste). Se for, loga inteiro e responde 200: não há cliente real
        // esperando, e devolver 500 só faria o Mercado Pago reenviar para
        // sempre — foi o que encheu o log de "Payment not found" repetido.
        const doTeste = await lerPagamentoComTokenDeTeste(data && data.id);
        if (doTeste) {
          console.log(`[webhook-investigacao] PAGAMENTO ${data.id} pertence à conta de TESTE.` +
            ` status=${doTeste.status} status_detail=${doTeste.status_detail}` +
            ` valor=${doTeste.transaction_amount}`);
          console.log(`[webhook-investigacao] PAGAMENTO ${data.id} completo:`, JSON.stringify(doTeste));
          return res.status(200).json({ ok: true, investigacao: 'pagamento de conta de teste' });
        }
        // Nenhum dos dois tokens leu: comportamento de sempre — deixa subir,
        // vira 500, e o Mercado Pago reenvia. Um Pix real que falhou por
        // instabilidade NÃO pode ser engolido em silêncio.
        throw erroLeitura;
      }

      const tipoOperacao = pagamento.operation_type;

      // Correção do bug documentado na Fatia 1: metadata tem donos
      // diferentes dependendo do tipo de pagamento. Três ramos explícitos —
      // um quarto tipo ainda não visto cai no "else" de baixo, logado, não
      // processado por exclusão.
      if (tipoOperacao === 'card_validation') {
        // Validação de cartão que o Mercado Pago faz antes da cobrança —
        // não é cobrança de verdade. Não libera nem encerra nada.
        console.log(`[webhook] pagamento ${pagamento.id} é card_validation — ignorado (não é cobrança).`);

      } else if (tipoOperacao === 'recurring_payment') {
        // Cobrança de ciclo de assinatura (cartão recorrente).
        const idAssinatura =
          pagamento.point_of_interaction?.transaction_data?.subscription_id ||
          pagamento.metadata?.preapproval_id;

        const [prefixoReferencia, usuario_id, plano] = (pagamento.external_reference || '').split(':');

        if (prefixoReferencia !== 'cartao' || !usuario_id || !planos[plano]) {
          console.error(`[webhook] recurring_payment ${pagamento.id} com external_reference` +
            ` inesperado ("${pagamento.external_reference}") — premium NÃO liberado automaticamente.` +
            ` Confira manualmente a assinatura ${idAssinatura || '(desconhecida)'}.`);
        } else if (pagamento.status === 'approved') {
          try {
            // INSERT direto: se mercadopago_payment_id já existir, a
            // constraint única barra a segunda tentativa — dedup atômico,
            // sem checar-depois-inserir (ver Fatia 2).
            await PagamentoAssinaturaProcessado.create({
              mercadopago_payment_id: String(pagamento.id),
              usuario_id,
              mercadopago_subscription_id: idAssinatura || 'desconhecida',
              numero_ciclo: pagamento.point_of_interaction?.transaction_data?.subscription_sequence?.number ?? null,
              valor: pagamento.transaction_amount
            });

            const premium_ate = await ativarPlanoDoUsuario(usuario_id, plano);
            if (premium_ate) {
              console.log(`Usuario ${usuario_id} ativou Premium ${plano} (cartão recorrente) ate ${premium_ate}`);
            }
          } catch (erroDedup) {
            if (erroDedup.name === 'SequelizeUniqueConstraintError') {
              console.log(`[webhook] pagamento ${pagamento.id} já tinha sido processado — ignorando duplicata.`);
            } else {
              throw erroDedup;
            }
          }
        }
        // Cobrança recusada/em retry num ciclo: não encerra o plano aqui de
        // propósito. O Mercado Pago já retenta sozinho, e premium_ate segue
        // valendo até a data do ciclo já pago — verificarAssinaturasVencidas
        // encerra normalmente se a renovação nunca vier a confirmar.

      } else if (tipoOperacao === 'regular_payment') {
        // Pix avulso — caminho de sempre, inalterado.
        if (pagamento.status === 'approved') {
          const { usuario_id, plano } = pagamento.metadata;
          const premium_ate = await ativarPlanoDoUsuario(usuario_id, plano);
          if (premium_ate) {
            console.log(`Usuario ${usuario_id} ativou Premium ${plano} ate ${premium_ate}`);
          }
        }

        // Pagamento que não deu certo (recusado, estornado, cancelado antes
        // de compensar). Só encerra o plano se o pagamento em questão for o
        // que sustenta a assinatura atual — um PIX antigo estornado não deve
        // derrubar uma assinatura nova que já foi paga.
        const statusEncerram = ['cancelled', 'rejected', 'refunded', 'charged_back'];
        if (statusEncerram.includes(pagamento.status)) {
          const { usuario_id, plano } = pagamento.metadata || {};
          if (usuario_id) {
            const usuario = await Usuario.findByPk(usuario_id, { attributes: ['id', 'plano_atual'] });
            if (usuario && usuario.plano_atual === plano) {
              await encerrarPlanoDoUsuario(usuario_id);
              console.log(`Usuario ${usuario_id} teve o plano ${plano} encerrado (status ${pagamento.status})`);
            }
          }
        }

      } else {
        console.error(`[webhook] operation_type desconhecido: "${tipoOperacao}" no pagamento ${pagamento.id}.` +
          ` Nada foi processado — investigar antes de mapear.`);
      }
    }

    res.status(200).json({ ok: true });

  } catch (erro) {
    console.error('Erro no webhook:', erro.message);
    res.status(500).json({ erro: erro.message });
  }
};

const verificarPremium = async (req, res) => {
  try {
    const usuario = await Usuario.findByPk(req.usuarioId, {
      attributes: ['id', 'nome', 'premium', 'premium_ate']
    });

    const agora = new Date();
    let premium_ativo = false;

    if (usuario.premium && usuario.premium_ate) {
      premium_ativo = new Date(usuario.premium_ate) > agora;
      if (!premium_ativo) {
        // Expiração detectada "de passagem", quando o usuário abre o app.
        // Passa pelo mesmo caminho do job pra que a indicação seja cancelada
        // junto — antes isso só desligava o premium e deixava a indicação
        // ativa para sempre.
        await encerrarPlanoDoUsuario(req.usuarioId);
      }
    } else if (usuario.premium) {
      // Premium sem data de expiracao = ilimitado (fase gratuita atual)
      premium_ativo = true;
    }

    res.json({
      premium: premium_ativo,
      premium_ate: usuario.premium_ate,
      planos: {
        semanal: { valor: 9.90, dias: 7 },
        mensal: { valor: 24.90, dias: 30 },
        anual: { valor: 199.90, dias: 365 }
      }
    });

  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao verificar premium: ' + erro.message });
  }
};

const ativarPremiumTeste = async (req, res) => {
  try {
    const { plano } = req.body;
    const usuario_id = req.usuarioId;

    if (!planos[plano]) {
      return res.status(400).json({ erro: 'Plano inválido' });
    }

    // Mesmo caminho do webhook, pra que o ambiente de teste produza o mesmo
    // estado (inclusive criando a indicação do Programa de Parceiros).
    const premium_ate = await ativarPlanoDoUsuario(usuario_id, plano);

    res.json({
      mensagem: 'Premium ativado para teste!',
      plano: planos[plano].nome,
      premium_ate
    });

  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao ativar premium: ' + erro.message });
  }
};

/**
 * Varre assinaturas vencidas e encerra o plano de quem passou da data.
 *
 * POR QUE ISSO É OBRIGATÓRIO: os pagamentos aqui são PIX avulsos, não
 * assinatura recorrente do Mercado Pago. Cada pagamento compra N dias e
 * pronto. Quando esses dias acabam, o Mercado Pago NÃO manda nenhum evento —
 * não existe "assinatura" do lado dele pra vencer ou cancelar. Sem esta
 * varredura, quem pagou uma vez ficaria como indicado ativo para sempre, e o
 * parceiro receberia comissão indevidamente todo mês.
 *
 * O verificarPremium já derruba o plano quando o próprio usuário abre o app,
 * mas isso só cobre quem volta — justamente quem parou de usar é quem mais
 * precisa ser expirado.
 */
async function verificarAssinaturasVencidas() {
  const agora = new Date();
  const vencidos = await Usuario.findAll({
    where: {
      plano_atual: { [Op.ne]: null },
      premium_ate: { [Op.ne]: null, [Op.lt]: agora }
    },
    attributes: ['id']
  });

  for (const usuario of vencidos) {
    try {
      await encerrarPlanoDoUsuario(usuario.id);
    } catch (erro) {
      console.error(`Falha ao encerrar plano vencido do usuário ${usuario.id}:`, erro.message);
    }
  }

  if (vencidos.length) {
    console.log(`[assinaturas] ${vencidos.length} plano(s) vencido(s) encerrado(s).`);
  }
  return vencidos.length;
}

/**
 * Avisa por WhatsApp quem está prestes a perder o acesso, para reduzir
 * cancelamento por esquecimento (o pagamento aqui é PIX avulso: se a pessoa
 * não renovar por conta própria, a assinatura simplesmente acaba).
 *
 * Janela: de agora até 48h à frente — e NÃO "entre 24h e 48h". A diferença
 * importa: com a janela aberta na ponta de baixo, um envio que falhar hoje
 * (WhatsApp fora do ar, template ainda em análise) reaparece na execução de
 * amanhã, e assim por diante até funcionar ou a assinatura vencer de fato.
 * Com a janela fechada, uma falha significaria nunca mais tentar.
 *
 * lembrete_renovacao_enviado_em só é gravado em caso de SUCESSO — é ele que
 * impede o lembrete de repetir todo dia depois de entregue.
 */
async function verificarLembretesRenovacao() {
  const agora = new Date();
  const limite48h = new Date(agora.getTime() + 48 * 60 * 60 * 1000);

  const candidatos = await Usuario.findAll({
    where: {
      plano_atual: { [Op.ne]: null },
      premium_ate: { [Op.gt]: agora, [Op.lte]: limite48h },
      lembrete_renovacao_enviado_em: null
    },
    attributes: ['id', 'nome', 'telefone', 'plano_atual', 'premium_ate']
  });

  if (!candidatos.length) return { enviados: 0, sem_telefone: 0, falhas: 0 };

  const linkRenovacao = (process.env.APP_LINK_BASE || 'https://app.vinculoapp.com.br') + '/prototipo';
  let enviados = 0;
  let semTelefone = 0;
  let falhas = 0;

  for (const usuario of candidatos) {
    // Sem telefone (assinou antes desta coluna existir): pula sem marcar
    // nada. Se a pessoa cadastrar o telefone depois, entra numa próxima
    // execução automaticamente — não fica queimada.
    if (!usuario.telefone) { semTelefone++; continue; }

    const dataFormatada = new Date(usuario.premium_ate).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const resultado = await enviarMensagemTemplate(
      usuario.telefone,
      'lembrete_renovacao',
      [usuario.plano_atual, dataFormatada, linkRenovacao]
    );

    if (resultado.sucesso) {
      await Usuario.update(
        { lembrete_renovacao_enviado_em: new Date() },
        { where: { id: usuario.id } }
      );
      enviados++;
    } else {
      // Deixa lembrete_renovacao_enviado_em em null de propósito: a próxima
      // execução tenta de novo enquanto a assinatura não vencer.
      falhas++;
      console.error(`[lembrete-renovacao] falha ao enviar para usuário ${usuario.id}: ${resultado.erro}`);
    }
  }

  console.log(`[lembrete-renovacao] ${enviados} enviado(s), ${falhas} falha(s), ${semTelefone} sem telefone.`);
  return { enviados, sem_telefone: semTelefone, falhas };
}

module.exports = {
  criarPagamentoPix,
  criarAssinaturaCartao,
  webhook,
  verificarPremium,
  ativarPremiumTeste,
  ativarPlanoDoUsuario,
  encerrarPlanoDoUsuario,
  verificarAssinaturasVencidas,
  verificarLembretesRenovacao
};
