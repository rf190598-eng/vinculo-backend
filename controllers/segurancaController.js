const ContatoConfianca = require('../models/ContatoConfianca');
const AlertaSeguranca = require('../models/AlertaSeguranca');
const SessaoSeguranca = require('../models/SessaoSeguranca');
const Usuario = require('../models/Usuario');
const AvaliacaoEncontro = require('../models/AvaliacaoEncontro');
const { enviarMensagemTemplate, normalizarTelefoneE164 } = require('../services/whatsappService');

const NOMES_TEMPLATE = {
  panico: 'alerta_panico',
  checkin_perdido: 'alerta_checkin_perdido'
};

// DDDs realmente existentes no Brasil (fonte: plano de numeração da Anatel).
// Números com DDD fora dessa lista são rejeitados no cadastro de contato de
// confiança, mesmo que tenham a quantidade certa de dígitos.
const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99
]);

// Log de tentativa rejeitada de cadastro de contato de confiança. Não loga o
// telefone completo (dado sensível) — só o suficiente pra auditoria/debug.
function logTentativaContatoRejeitada(usuarioId, motivo) {
  console.warn(`[seguranca] contato de confiança rejeitado - usuario:${usuarioId} motivo:"${motivo}" em:${new Date().toISOString()}`);
}

// Envia o alerta de verdade pelo WhatsApp para cada contato de confiança,
// em paralelo. Não lança exceção: cada envio que falhar vira um resultado
// com sucesso:false, sem derrubar os demais nem o fluxo de quem chamou.
async function enviarAlertasWhatsapp(usuario, contatos, tipo, latitude, longitude) {
  const linkMapa = (latitude && longitude)
    ? `https://www.google.com/maps?q=${latitude},${longitude}`
    : 'localização não disponível';

  const nomeTemplate = NOMES_TEMPLATE[tipo] || NOMES_TEMPLATE.panico;

  return Promise.all(contatos.map(async (c) => {
    const resultado = await enviarMensagemTemplate(c.telefone, nomeTemplate, [usuario.nome, linkMapa]);
    return {
      contato_nome: c.nome,
      contato_telefone: c.telefone,
      template_usado: nomeTemplate,
      sucesso: resultado.sucesso,
      ...(resultado.sucesso ? {} : { erro: resultado.erro })
    };
  }));
}

// ===== CONTATOS DE CONFIANÇA =====

const listarContatos = async (req, res) => {
  try {
    const contatos = await ContatoConfianca.findAll({ where: { usuario_id: req.usuarioId } });
    res.json({ contatos });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao listar contatos: ' + erro.message });
  }
};

// PENDÊNCIA ANOTADA (decisão de produto, não técnica): esta função ainda não
// valida se o telefone cadastrado é o próprio número do usuário logado,
// porque o model Usuario não tem nenhum campo de telefone hoje. Adicionar
// essa checagem exige decidir antes: telefone obrigatório ou não no
// cadastro, o que fazer com contas já existentes, migration, tela de
// onboarding. Tratar como tarefa própria — Roberto decide quando.
const criarContato = async (req, res) => {
  try {
    const { nome, telefone, parentesco } = req.body;
    if (!nome || !telefone) {
      logTentativaContatoRejeitada(req.usuarioId, 'nome ou telefone ausente');
      return res.status(400).json({ erro: 'Nome e telefone são obrigatórios' });
    }

    const telefoneNormalizado = normalizarTelefoneE164(telefone);
    // 13 dígitos = 55 (DDI) + DDD (2) + 9º dígito + número (8). Qualquer
    // coisa fora disso indica DDD ausente/errado ou número incompleto —
    // a normalização não tem como "consertar" esses casos, só sinalizar.
    // 55 (DDI) + DDD (2) + "9" obrigatório (todo celular brasileiro de 9
    // dígitos começa assim) + 8 dígitos restantes. Sem o "9" fixo aqui, um
    // número como 13 dígitos mas começando em 1-5 depois do DDD passava
    // como válido mesmo não existindo como celular real.
    if (!/^55\d{2}9\d{8}$/.test(telefoneNormalizado)) {
      logTentativaContatoRejeitada(req.usuarioId, 'formato E.164 inválido');
      return res.status(400).json({ erro: 'Telefone inválido. Use o formato (DD) 9XXXX-XXXX' });
    }

    const ddd = Number(telefoneNormalizado.slice(2, 4));
    if (!DDDS_VALIDOS.has(ddd)) {
      logTentativaContatoRejeitada(req.usuarioId, `DDD inexistente (${ddd})`);
      return res.status(400).json({ erro: 'Telefone inválido. Use o formato (DD) 9XXXX-XXXX' });
    }

    const jaCadastrado = await ContatoConfianca.findOne({
      where: { usuario_id: req.usuarioId, telefone: telefoneNormalizado }
    });
    if (jaCadastrado) {
      logTentativaContatoRejeitada(req.usuarioId, 'telefone duplicado');
      return res.status(400).json({ erro: 'Esse telefone já está cadastrado como contato de confiança' });
    }

    const contato = await ContatoConfianca.create({
      usuario_id: req.usuarioId, nome, telefone: telefoneNormalizado, parentesco
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

// ===== BOTÃO DE PÂNICO =====

const dispararPanico = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    // LOG TEMPORÁRIO DE DIAGNÓSTICO — remover depois de confirmar a causa.
    console.log(`[panico] localizacao recebida - usuario:${req.usuarioId} latitude:${latitude} longitude:${longitude}`);
    const usuario = await Usuario.findByPk(req.usuarioId);
    const contatos = await ContatoConfianca.findAll({ where: { usuario_id: req.usuarioId } });

    if (contatos.length === 0) {
      return res.status(400).json({ erro: 'Você ainda não tem contatos de confiança cadastrados' });
    }

    const mensagens = await enviarAlertasWhatsapp(usuario, contatos, 'panico', latitude, longitude);

    await AlertaSeguranca.create({
      usuario_id: req.usuarioId,
      tipo: 'panico',
      latitude,
      longitude,
      mensagens_enviadas: mensagens
    });

    // Mesmo que TODOS os envios de WhatsApp tenham falhado (token vencido,
    // template rejeitado, número inválido etc), a resposta continua sendo
    // de sucesso: o alerta já está registrado no banco, e quem está com o
    // botão de pânico na mão não pode achar que ele "não funcionou" por
    // causa de uma falha numa integração externa.
    res.json({ mensagem: 'Alerta disparado!', mensagens });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao disparar alerta: ' + erro.message });
  }
};

// ===== SESSÃO DE SEGURANÇA (encontro / check-in) =====

const iniciarSessao = async (req, res) => {
  try {
    const { minutos, latitude, longitude, com_usuario_id } = req.body;
    await SessaoSeguranca.update(
      { ativa: false },
      { where: { usuario_id: req.usuarioId, ativa: true } }
    );
    const prazo_confirmacao = minutos
      ? new Date(Date.now() + minutos * 60 * 1000)
      : null;
    const sessao = await SessaoSeguranca.create({
      usuario_id: req.usuarioId,
      com_usuario_id: com_usuario_id || null,
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

// Chamada periodicamente pelo servidor (não pelo app) para checar check-ins vencidos
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
        const mensagens = await enviarAlertasWhatsapp(usuario, contatos, 'checkin_perdido', sessao.ultima_lat, sessao.ultima_lng);
        await AlertaSeguranca.create({
          usuario_id: sessao.usuario_id,
          tipo: 'checkin_perdido',
          latitude: sessao.ultima_lat,
          longitude: sessao.ultima_lng,
          mensagens_enviadas: mensagens
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


const listarSessoesParaAvaliar = async (req, res) => {
  try {
    const sessoesEncerradas = await SessaoSeguranca.findAll({
      where: { usuario_id: req.usuarioId, ativa: false }
    });
    const pendentes = [];
    for (const sessao of sessoesEncerradas) {
      const jaAvaliou = await AvaliacaoEncontro.findOne({
        where: { sessao_seguranca_id: sessao.id, usuario_id: req.usuarioId }
      });
      if (!jaAvaliou) pendentes.push({ id: sessao.id, criado_em: sessao.createdAt });
    }
    res.json({ pendentes });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao listar sessões: ' + erro.message });
  }
};

const criarAvaliacaoEncontro = async (req, res) => {
  try {
    const { sessao_seguranca_id, nota, comentario } = req.body;
    const sessao = await SessaoSeguranca.findOne({ where: { id: sessao_seguranca_id, usuario_id: req.usuarioId } });
    if (!sessao) return res.status(404).json({ erro: 'Check-in não encontrado' });

    const avaliacao = await AvaliacaoEncontro.create({
      sessao_seguranca_id, usuario_id: req.usuarioId, nota, comentario
    });
    res.status(201).json({ mensagem: 'Avaliação registrada!', avaliacao });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao avaliar: ' + erro.message });
  }
};

module.exports = {
  listarContatos, criarContato, removerContato,
  dispararPanico,
  iniciarSessao, atualizarLocalizacaoSessao, confirmarRetornoSeguro, statusSessao,
  verificarCheckinsVencidos,
  listarSessoesParaAvaliar, criarAvaliacaoEncontro
};
