const ContatoConfianca = require('../models/ContatoConfianca');
const AlertaSeguranca = require('../models/AlertaSeguranca');
const SessaoSeguranca = require('../models/SessaoSeguranca');
const Usuario = require('../models/Usuario');

// Monta as mensagens que SERIAM enviadas por WhatsApp para cada contato.
// Por enquanto é simulado - não envia de verdade, só registra e devolve pro app mostrar.
function montarMensagens(usuario, contatos, tipo, latitude, longitude) {
  const linkMapa = (latitude && longitude)
    ? `https://www.google.com/maps?q=${latitude},${longitude}`
    : 'localização não disponível';

  const textos = {
    panico: `🚨 ALERTA VÍNCULO: ${usuario.nome} pode estar em perigo e precisa de ajuda agora. Última localização: ${linkMapa}`,
    checkin_perdido: `⚠️ ALERTA VÍNCULO: ${usuario.nome} não confirmou que chegou bem em segurança após um encontro combinado pelo app. Última localização conhecida: ${linkMapa}`
  };

  return contatos.map(c => ({
    contato_nome: c.nome,
    contato_telefone: c.telefone,
    mensagem: textos[tipo] || textos.panico,
    enviado_simulado: true
  }));
}

const listarContatos = async (req, res) => {
  try {
    const contatos = await ContatoConfianca.findAll({ where: { usuario_id: req.usuarioId } });
    res.json({ contatos });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao listar contatos: ' + erro.message });
  }
};

const criarContato = async (req, res) => {
  try {
    const { nome, telefone, parentesco } = req.body;
    if (!nome || !telefone) {
      return res.status(400).json({ erro: 'Nome e telefone são obrigatórios' });
    }
    const contato = await ContatoConfianca.create({
      usuario_id: req.usuarioId, nome, telefone, parentesco
    });
    res.status(201).json({ mensagem: 'Contato adicionado!', contato });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao criar contato: ' + erro.message });
  }
};

const removerContato = async (req, res) => {
  try {
    const { id } = req.params;
    await ContatoConfianca.destroy({ where: { id, usuario_id: req.usuarioId } });
    res.json({ mensagem: 'Contato removido' });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao remover contato: ' + erro.message });
  }
};

const dispararPanico = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    const usuario = await Usuario.findByPk(req.usuarioId);
    const contatos = await ContatoConfianca.findAll({ where: { usuario_id: req.usuarioId } });

    if (contatos.length === 0) {
      return res.status(400).json({ erro: 'Você ainda não tem contatos de confiança cadastrados' });
    }

    const mensagens = montarMensagens(usuario, contatos, 'panico', latitude, longitude);

    await AlertaSeguranca.create({
      usuario_id: req.usuarioId,
      tipo: 'panico',
      latitude,
      longitude,
      mensagens_simuladas: mensagens
    });

    res.json({ mensagem: 'Alerta disparado!', mensagens });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao disparar alerta: ' + erro.message });
  }
};

const iniciarSessao = async (req, res) => {
  try {
    const { minutos, latitude, longitude } = req.body;
    await SessaoSeguranca.update(
      { ativa: false },
      { where: { usuario_id: req.usuarioId, ativa: true } }
    );
    const prazo_confirmacao = minutos
      ? new Date(Date.now() + minutos * 60 * 1000)
      : null;
    const sessao = await SessaoSeguranca.create({
      usuario_id: req.usuarioId,
      ativa: true,
      prazo_confirmacao,
      ultima_lat: latitude,
      ultima_lng: longitude
    });
    res.status(201).json({ mensagem: 'Sessão de segurança iniciada!', sessao });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao iniciar sessão: ' + erro.message });
  }
};

const atualizarLocalizacaoSessao = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    await SessaoSeguranca.update(
      { ultima_lat: latitude, ultima_lng: longitude },
      { where: { usuario_id: req.usuarioId, ativa: true } }
    );
    res.json({ mensagem: 'Localização atualizada' });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao atualizar localização: ' + erro.message });
  }
};

const confirmarRetornoSeguro = async (req, res) => {
  try {
    await SessaoSeguranca.update(
      { ativa: false },
      { where: { usuario_id: req.usuarioId, ativa: true } }
    );
    res.json({ mensagem: 'Que bom que você chegou bem!' });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao confirmar: ' + erro.message });
  }
};

const statusSessao = async (req, res) => {
  try {
    const sessao = await SessaoSeguranca.findOne({
      where: { usuario_id: req.usuarioId, ativa: true },
      order: [['createdAt', 'DESC']]
    });
    const ultimoAlerta = await AlertaSeguranca.findOne({
      where: { usuario_id: req.usuarioId },
      order: [['createdAt', 'DESC']]
    });
    res.json({ sessao, ultimo_alerta_automatico: ultimoAlerta });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao buscar status: ' + erro.message });
  }
};

const verificarCheckinsVencidos = async () => {
  try {
    const agora = new Date();
    const { Op } = require('sequelize');
    const vencidas = await SessaoSeguranca.findAll({
      where: { ativa: true, alerta_disparado: false, prazo_confirmacao: { [Op.lt]: agora } }
    });
    for (const sessao of vencidas) {
      const usuario = await Usuario.findByPk(sessao.usuario_id);
      const contatos = await ContatoConfianca.findAll({ where: { usuario_id: sessao.usuario_id } });
      if (usuario && contatos.length > 0) {
        const mensagens = montarMensagens(usuario, contatos, 'checkin_perdido', sessao.ultima_lat, sessao.ultima_lng);
        await AlertaSeguranca.create({
          usuario_id: sessao.usuario_id,
          tipo: 'checkin_perdido',
          latitude: sessao.ultima_lat,
          longitude: sessao.ultima_lng,
          mensagens_simuladas: mensagens
        });
        console.log(`Alerta automatico disparado para usuario ${sessao.usuario_id}`);
      }
      sessao.alerta_disparado = true;
      await sessao.save();
    }
  } catch (erro) {
    console.error('Erro ao verificar check-ins vencidos:', erro.message);
  }
};

module.exports = {
  listarContatos, criarContato, removerContato,
  dispararPanico,
  iniciarSessao, atualizarLocalizacaoSessao, confirmarRetornoSeguro, statusSessao,
  verificarCheckinsVencidos
};
