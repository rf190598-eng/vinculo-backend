const crypto = require('crypto');
const bcrypt = require('bcryptjs'); // se seu authController usa 'bcrypt' em vez de 'bcryptjs', troque aqui também
const Usuario = require('../models/Usuario');
const { enviarEmail } = require('../utils/email');

// Passo 1: usuária pede recuperação, informando o e-mail
const solicitarRecuperacao = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ erro: 'Informe o e-mail' });
    }

    const usuario = await Usuario.findOne({ where: { email } });

    const respostaPadrao = {
      mensagem: 'Se este e-mail estiver cadastrado, você receberá um link de recuperação em instantes.'
    };

    if (!usuario) {
      return res.json(respostaPadrao);
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expira = new Date(Date.now() + 30 * 60 * 1000);

    await Usuario.update(
      { reset_token: token, reset_token_expira: expira },
      { where: { id: usuario.id } }
    );

    const link = `${process.env.APP_URL}/redefinir-senha?token=${token}`;

    await enviarEmail(
      usuario.email,
      'Recuperação de senha - Vínculo',
      `
        <p>Olá, ${usuario.nome}!</p>
        <p>Recebemos uma solicitação para redefinir sua senha no Vínculo.</p>
        <p><a href="${link}">Clique aqui para criar uma nova senha</a></p>
        <p>Este link expira em 30 minutos. Se você não solicitou isso, ignore este e-mail — sua senha continua segura.</p>
      `
    );

    res.json(respostaPadrao);
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao solicitar recuperação: ' + erro.message });
  }
};

// Passo 2: usuária clica no link, informa o token + nova senha
const redefinirSenha = async (req, res) => {
  try {
    const { token, novaSenha } = req.body;
    if (!token || !novaSenha) {
      return res.status(400).json({ erro: 'Token e nova senha são obrigatórios' });
    }
    if (novaSenha.length < 6) {
      return res.status(400).json({ erro: 'A senha deve ter pelo menos 6 caracteres' });
    }

    const usuario = await Usuario.findOne({ where: { reset_token: token } });

    if (!usuario || !usuario.reset_token_expira || usuario.reset_token_expira < new Date()) {
      return res.status(400).json({ erro: 'Link inválido ou expirado. Solicite a recuperação novamente.' });
    }

    const senhaCriptografada = await bcrypt.hash(novaSenha, 10);

    await Usuario.update(
      { senha: senhaCriptografada, reset_token: null, reset_token_expira: null },
      { where: { id: usuario.id } }
    );

    res.json({ mensagem: 'Senha redefinida com sucesso! Você já pode fazer login com a nova senha.' });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao redefinir senha: ' + erro.message });
  }
};

module.exports = { solicitarRecuperacao, redefinirSenha };