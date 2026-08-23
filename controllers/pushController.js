const InscricaoPush = require('../models/InscricaoPush');

// Inscrição enviada pelo frontend depois de registration.pushManager.subscribe().
// Atualiza por endpoint em vez de sempre criar: o mesmo endpoint pode voltar
// (reinstalar o app, trocar de conta no mesmo aparelho) — sem isso, cada
// reinscrição acumularia uma linha nova ou colidiria com a unicidade.
const inscrever = async (req, res) => {
  try {
    const usuario_id = req.usuarioId;
    const { endpoint, keys, user_agent } = req.body;

    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      return res.status(400).json({ erro: 'Inscrição de push inválida.' });
    }

    const existente = await InscricaoPush.findOne({ where: { endpoint } });
    if (existente) {
      existente.usuario_id = usuario_id;
      existente.p256dh = keys.p256dh;
      existente.auth = keys.auth;
      existente.user_agent = user_agent ? String(user_agent).slice(0, 255) : null;
      await existente.save();
      return res.status(200).json({ mensagem: 'Inscrição de push atualizada!', id: existente.id });
    }

    const nova = await InscricaoPush.create({
      usuario_id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: user_agent ? String(user_agent).slice(0, 255) : null
    });
    res.status(201).json({ mensagem: 'Inscrição de push salva!', id: nova.id });
  } catch (erro) {
    res.status(500).json({ erro: 'Não foi possível salvar a inscrição de push: ' + erro.message });
  }
};

// Chamado ao desativar o interruptor no aparelho.
const desinscrever = async (req, res) => {
  try {
    const usuario_id = req.usuarioId;
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ erro: 'endpoint é obrigatório.' });

    await InscricaoPush.destroy({ where: { usuario_id, endpoint } });
    res.json({ mensagem: 'Inscrição de push removida.' });
  } catch (erro) {
    res.status(500).json({ erro: 'Não foi possível remover a inscrição de push: ' + erro.message });
  }
};

// Expõe a chave pública VAPID pro frontend sem hardcodar no HTML — trocar a
// chave no futuro não vai exigir deploy do frontend.
const chavePublica = async (req, res) => {
  if (!process.env.VAPID_PUBLIC_KEY) {
    return res.status(503).json({ erro: 'Push não está configurado neste servidor.' });
  }
  res.json({ chave: process.env.VAPID_PUBLIC_KEY });
};

module.exports = { inscrever, desinscrever, chavePublica };
