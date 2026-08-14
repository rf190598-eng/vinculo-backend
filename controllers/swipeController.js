const Swipe = require('../models/Swipe');
const Match = require('../models/Match');
const Usuario = require('../models/Usuario');
const Notificacao = require('../models/Notificacao');
const Bloqueio = require('../models/Bloqueio');
const { Op } = require('sequelize');
const { temPremiumAtivo } = require('../utils/premium');

function calcularDistanciaKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calcularIdadeServidor(dataNascimento) {
  if (!dataNascimento) return null;
  const hoje = new Date();
  const nasc = new Date(dataNascimento);
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const aniversarioNaoChegou = (hoje.getMonth() < nasc.getMonth()) ||
    (hoje.getMonth() === nasc.getMonth() && hoje.getDate() < nasc.getDate());
  if (aniversarioNaoChegou) idade--;
  return idade;
}

// Retorna a lista de IDs envolvidos em bloqueio com o usuário informado,
// nos dois sentidos: quem ele bloqueou e quem o bloqueou.
async function obterIdsBloqueados(usuario_id) {
  const bloqueios = await Bloqueio.findAll({
    where: {
      [Op.or]: [
        { usuario_id: usuario_id },
        { bloqueado_id: usuario_id }
      ]
    }
  });

  const ids = new Set();
  bloqueios.forEach((b) => {
    if (b.usuario_id === usuario_id) ids.add(b.bloqueado_id);
    else ids.add(b.usuario_id);
  });

  return Array.from(ids);
}

const darSwipe = async (req, res) => {
  try {
    const { alvo_id, tipo } = req.body;
    const usuario_id = req.usuarioId;

    // Impede interação entre usuários bloqueados, em qualquer sentido
    const bloqueioExiste = await Bloqueio.findOne({
      where: {
        [Op.or]: [
          { usuario_id: usuario_id, bloqueado_id: alvo_id },
          { usuario_id: alvo_id, bloqueado_id: usuario_id }
        ]
      }
    });
    if (bloqueioExiste) {
      return res.status(403).json({ erro: 'Não é possível interagir com este perfil' });
    }

    const swipeExiste = await Swipe.findOne({
      where: { usuario_id, alvo_id }
    });
    if (swipeExiste) {
      return res.status(400).json({ erro: 'Você já avaliou esse perfil' });
    }
    await Swipe.create({ usuario_id, alvo_id, tipo });

    let match = null;
    if (tipo === 'like' || tipo === 'superlike') {
      const swipeReciproco = await Swipe.findOne({
        where: {
          usuario_id: alvo_id,
          alvo_id: usuario_id,
          tipo: ['like', 'superlike']
        }
      });
      if (swipeReciproco) {
        match = await Match.create({
          usuario1_id: usuario_id,
          usuario2_id: alvo_id
        });

        const usuarioAtual = await Usuario.findByPk(usuario_id);
        const usuarioAlvo = await Usuario.findByPk(alvo_id);
        await Notificacao.create({
          usuario_id: usuario_id,
          tipo: 'match',
          texto: `Você deu um Vínculo com ${usuarioAlvo.nome}!`
        });
        await Notificacao.create({
          usuario_id: alvo_id,
          tipo: 'match',
          texto: `Você deu um Vínculo com ${usuarioAtual.nome}!`
        });
      } else {
        await Notificacao.create({
          usuario_id: alvo_id,
          tipo: 'curtida',
          texto: 'Alguém curtiu seu perfil! Assine o Premium pra ver quem é.'
        });
      }
    }

    if (match) {
      return res.json({
        mensagem: 'É um Vínculo!',
        match: true,
        match_id: match.id
      });
    }
    res.json({
      mensagem: 'Swipe registrado!',
      match: false
    });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao dar swipe: ' + erro.message });
  }
};

const listarPerfis = async (req, res) => {
  try {
    const usuario_id = req.usuarioId;
    const eu = await Usuario.findByPk(usuario_id);

    const jaAvaliados = await Swipe.findAll({
      where: { usuario_id },
      attributes: ['alvo_id']
    });
    const idsAvaliados = jaAvaliados.map(s => s.alvo_id);
    idsAvaliados.push(usuario_id);

    // Remove do feed qualquer usuário envolvido em bloqueio (nos dois sentidos)
    const idsBloqueados = await obterIdsBloqueados(usuario_id);
    idsBloqueados.forEach((id) => idsAvaliados.push(id));

    const where = {
      id: { [Op.notIn]: idsAvaliados },
      ativo: true
    };
    if (eu.pref_genero && eu.pref_genero !== 'todos') {
      where.genero = eu.pref_genero;
    }

    let candidatos = await Usuario.findAll({
      where,
      attributes: { exclude: ['senha', 'foto_verificacao'] }
    });

    candidatos = candidatos.filter(c => {
      const idade = calcularIdadeServidor(c.data_nascimento);
      if (idade === null) return true;
      if (eu.pref_idade_min && idade < eu.pref_idade_min) return false;
      if (eu.pref_idade_max && idade > eu.pref_idade_max) return false;
      return true;
    });
    if (eu.pref_apenas_verificados) {
      candidatos = candidatos.filter(c => c.verificado === true);
    }
    if (eu.pref_objetivo) {
      candidatos = candidatos.filter(c => c.objetivo === eu.pref_objetivo);
    }

    if (temPremiumAtivo(eu)) {
      candidatos = candidatos.filter(c => {
        if (eu.pref_altura_min && c.altura && c.altura < eu.pref_altura_min) return false;
        if (eu.pref_altura_max && c.altura && c.altura > eu.pref_altura_max) return false;
        if (eu.pref_peso_min && c.peso && c.peso < eu.pref_peso_min) return false;
        if (eu.pref_peso_max && c.peso && c.peso > eu.pref_peso_max) return false;
        if (eu.pref_cor_cabelo && c.cor_cabelo && c.cor_cabelo !== eu.pref_cor_cabelo) return false;
        return true;
      });
    }

    if (eu.pref_distancia_km && eu.latitude && eu.longitude) {
      candidatos = candidatos.filter(c => {
        if (!c.latitude || !c.longitude) return true;
        const dist = calcularDistanciaKm(eu.latitude, eu.longitude, c.latitude, c.longitude);
        return dist <= eu.pref_distancia_km;
      });
    }

    res.json({ perfis: candidatos.slice(0, 10) });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao listar perfis: ' + erro.message });
  }
};

const listarMatches = async (req, res) => {
  try {
    const usuario_id = req.usuarioId;
    const Mensagem = require('../models/Mensagem');
    const matches = await Match.findAll({
      where: {
        [Op.or]: [
          { usuario1_id: usuario_id },
          { usuario2_id: usuario_id }
        ],
        ativo: true
      }
    });

    const matchesComPerfil = await Promise.all(matches.map(async (match) => {
      const outroId = match.usuario1_id === usuario_id ? match.usuario2_id : match.usuario1_id;
      const outroUsuario = await Usuario.findByPk(outroId, {
        attributes: ['id', 'nome', 'foto_url', 'verificado', 'data_nascimento']
      });
      const totalMensagens = await Mensagem.count({ where: { match_id: match.id } });
      return {
        id: match.id,
        criado_em: match.createdAt,
        outro_usuario: outroUsuario,
        sem_mensagens: totalMensagens === 0
      };
    }));

    res.json({ matches: matchesComPerfil });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao listar matches: ' + erro.message });
  }
};

const listarCurtidasRecebidas = async (req, res) => {
  try {
    const usuario_id = req.usuarioId;
    const eu = await Usuario.findByPk(usuario_id, {
      attributes: ['id', 'premium', 'premium_ate']
    });

    const curtidasRecebidas = await Swipe.findAll({
      where: { alvo_id: usuario_id, tipo: ['like', 'superlike'] }
    });

    const meusSwipes = await Swipe.findAll({
      where: { usuario_id },
      attributes: ['alvo_id']
    });
    const jaAvaliadosPorMim = meusSwipes.map(s => s.alvo_id);

    // Remove também quem está envolvido em bloqueio, nos dois sentidos
    const idsBloqueados = await obterIdsBloqueados(usuario_id);

    const pendentes = curtidasRecebidas.filter(c =>
      !jaAvaliadosPorMim.includes(c.usuario_id) && !idsBloqueados.includes(c.usuario_id)
    );

    const idsPendentes = pendentes.map(p => p.usuario_id);

    // PAYWALL NO SERVIDOR. Até esta versão, os perfis completos (nome, foto,
    // idade) eram devolvidos a qualquer usuário autenticado e o bloqueio era
    // só um blur de CSS no cliente — bastava abrir a aba Network do navegador
    // para ver de graça exatamente a lista que a assinatura vende.
    //
    // O total continua público de propósito: é ele que alimenta o
    // "N pessoas já curtiram seu perfil". O que fica protegido é QUEM são.
    if (!temPremiumAtivo(eu)) {
      return res.json({ total: idsPendentes.length, perfis: [], premium: false });
    }

    const perfis = await Usuario.findAll({
      where: { id: { [Op.in]: idsPendentes } },
      attributes: { exclude: ['senha', 'foto_verificacao'] }
    });

    res.json({ total: perfis.length, perfis, premium: true });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao listar curtidas: ' + erro.message });
  }
};

module.exports = { darSwipe, listarPerfis, listarMatches, listarCurtidasRecebidas };
