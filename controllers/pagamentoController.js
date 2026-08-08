const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const { Op } = require('sequelize');
const Usuario = require('../models/Usuario');
const { sincronizarIndicacaoDoUsuario } = require('./parceiroController');

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
    { premium: true, premium_ate, plano_atual: plano },
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
    const { plano } = req.body;
    const usuario_id = req.usuarioId;

    if (!planos[plano]) {
      return res.status(400).json({ erro: 'Plano inválido. Use: semanal, mensal ou anual' });
    }

    const usuario = await Usuario.findByPk(usuario_id);
    const planoEscolhido = planos[plano];

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

const webhook = async (req, res) => {
  try {
    const { type, data } = req.body;

    if (type === 'payment') {
      const payment = new Payment(client);
      const pagamento = await payment.get({ id: data.id });

      if (pagamento.status === 'approved') {
        const { usuario_id, plano } = pagamento.metadata;
        const premium_ate = await ativarPlanoDoUsuario(usuario_id, plano);
        if (premium_ate) {
          console.log(`Usuario ${usuario_id} ativou Premium ${plano} ate ${premium_ate}`);
        }
      }

      // Pagamento que não deu certo (recusado, estornado, cancelado antes de
      // compensar). Só encerra o plano se o pagamento em questão for o que
      // sustenta a assinatura atual — um PIX antigo estornado não deve
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

module.exports = {
  criarPagamentoPix,
  webhook,
  verificarPremium,
  ativarPremiumTeste,
  ativarPlanoDoUsuario,
  encerrarPlanoDoUsuario,
  verificarAssinaturasVencidas
};
