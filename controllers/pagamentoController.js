const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const Usuario = require('../models/Usuario');

// Configurar Mercado Pago
const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN || 'TEST-token-aqui'
});

const planos = {
  semanal: { valor: 9.90, dias: 7, nome: 'Vínculo Premium Semanal' },
  mensal: { valor: 24.90, dias: 30, nome: 'Vínculo Premium Mensal' },
  anual: { valor: 199.90, dias: 365, nome: 'Vínculo Premium Anual' }
};

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
        const planoEscolhido = planos[plano];

        if (usuario_id && planoEscolhido) {
          const agora = new Date();
          const premium_ate = new Date(agora.getTime() + planoEscolhido.dias * 24 * 60 * 60 * 1000);

          await Usuario.update(
            { premium: true, premium_ate },
            { where: { id: usuario_id } }
          );

          console.log(`Usuario ${usuario_id} ativou Premium ${plano} ate ${premium_ate}`);
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
        await Usuario.update(
          { premium: false },
          { where: { id: req.usuarioId } }
        );
      }
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

    const planoEscolhido = planos[plano];
    const agora = new Date();
    const premium_ate = new Date(agora.getTime() + planoEscolhido.dias * 24 * 60 * 60 * 1000);

    await Usuario.update(
      { premium: true, premium_ate },
      { where: { id: usuario_id } }
    );

    res.json({
      mensagem: 'Premium ativado para teste!',
      plano: planoEscolhido.nome,
      premium_ate
    });

  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao ativar premium: ' + erro.message });
  }
};

module.exports = { criarPagamentoPix, webhook, verificarPremium, ativarPremiumTeste }; 
