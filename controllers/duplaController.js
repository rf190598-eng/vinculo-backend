const Dupla = require('../models/Dupla');
const DuplaAvaliacao = require('../models/DuplaAvaliacao');
const DuplaMatch = require('../models/DuplaMatch');
const MensagemDupla = require('../models/MensagemDupla');
const Usuario = require('../models/Usuario');
const Notificacao = require('../models/Notificacao');

async function getMinhaDupla(usuarioId) {
  const { Op } = require('sequelize');
  return await Dupla.findOne({
    where: {
      status: 'ativa',
      [Op.or]: [{ usuario1_id: usuarioId }, { usuario2_id: usuarioId }]
    }
  });
}

function outroMembro(dupla, usuarioId) {
  return dupla.usuario1_id === usuarioId ? dupla.usuario2_id : dupla.usuario1_id;
}

// ===== FORMAÇÃO DA DUPLA =====

const convidarParaDupla = async (req, res) => {
  try {
    const { codigo_indicacao } = req.body;
    const usuarioId = req.usuarioId;

    if (!codigo_indicacao) {
      return res.status(400).json({ erro: 'Informe o código do amigo' });
    }

    const amigo = await Usuario.findOne({ where: { codigo_indicacao } });
    if (!amigo) {
      return res.status(404).json({ erro: 'Não encontramos ninguém com esse código' });
    }
    if (amigo.id === usuarioId) {
      return res.status(400).json({ erro: 'Você não pode formar dupla consigo mesmo' });
    }
    if (!amigo.verificado) {
      return res.status(400).json({ erro: 'Esse amigo ainda não verificou o perfil dele' });
    }

    const minhaDupla = await getMinhaDupla(usuarioId);
    if (minhaDupla) {
      return res.status(400).json({ erro: 'Você já está em uma dupla ativa' });
    }

    const { Op } = require('sequelize');
    const conviteExistente = await Dupla.findOne({
      where: {
        status: 'pendente',
        [Op.or]: [
          { usuario1_id: usuarioId, usuario2_id: amigo.id },
          { usuario1_id: amigo.id, usuario2_id: usuarioId }
        ]
      }
    });
    if (conviteExistente) {
      return res.status(400).json({ erro: 'Já existe um convite pendente com essa pessoa' });
    }

    const dupla = await Dupla.create({ usuario1_id: usuarioId, usuario2_id: amigo.id, status: 'pendente' });
    res.status(201).json({ mensagem: 'Convite enviado!', dupla });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao convidar: ' + erro.message });
  }
};

const listarConvitesPendentes = async (req, res) => {
  try {
    const convites = await Dupla.findAll({
      where: { usuario2_id: req.usuarioId, status: 'pendente' }
    });
    const convitesComPerfil = await Promise.all(convites.map(async (c) => {
      const convidante = await Usuario.findByPk(c.usuario1_id, { attributes: ['id', 'nome', 'foto_url'] });
      return { id: c.id, convidante };
    }));
    res.json({ convites: convitesComPerfil });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao listar convites: ' + erro.message });
  }
};

const responderConvite = async (req, res) => {
  try {
    const { dupla_id } = req.params;
    const { aceitar } = req.body;
    const dupla = await Dupla.findOne({ where: { id: dupla_id, usuario2_id: req.usuarioId, status: 'pendente' } });
    if (!dupla) return res.status(404).json({ erro: 'Convite não encontrado' });

    if (aceitar) {
      const jaTenhoDupla = await getMinhaDupla(req.usuarioId);
      if (jaTenhoDupla) return res.status(400).json({ erro: 'Você já está em uma dupla ativa' });
      dupla.status = 'ativa';
      await dupla.save();
      res.json({ mensagem: 'Dupla formada!', dupla });
    } else {
      await dupla.destroy();
      res.json({ mensagem: 'Convite recusado' });
    }
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao responder convite: ' + erro.message });
  }
};

const statusDupla = async (req, res) => {
  try {
    const dupla = await getMinhaDupla(req.usuarioId);
    if (!dupla) return res.json({ dupla: null });
    const parceiroId = outroMembro(dupla, req.usuarioId);
    const parceiro = await Usuario.findByPk(parceiroId, { attributes: ['id', 'nome', 'foto_url'] });
    res.json({ dupla: { id: dupla.id, bio_conjunta: dupla.bio_conjunta, parceiro } });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao buscar status: ' + erro.message });
  }
};

const sairDaDupla = async (req, res) => {
  try {
    const dupla = await getMinhaDupla(req.usuarioId);
    if (!dupla) return res.status(400).json({ erro: 'Você não está em nenhuma dupla' });
    dupla.status = 'encerrada';
    await dupla.save();
    res.json({ mensagem: 'Você saiu da dupla' });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao sair da dupla: ' + erro.message });
  }
};

const editarBioDupla = async (req, res) => {
  try {
    const dupla = await getMinhaDupla(req.usuarioId);
    if (!dupla) return res.status(400).json({ erro: 'Você não está em nenhuma dupla ativa' });
    dupla.bio_conjunta = req.body.bio_conjunta || '';
    await dupla.save();
    res.json({ mensagem: 'Bio da dupla atualizada!', dupla });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao atualizar bio: ' + erro.message });
  }
};

// ===== SWIPE ENTRE DUPLAS =====

const listarDuplasParaAvaliar = async (req, res) => {
  try {
    const { Op } = require('sequelize');
    const minhaDupla = await getMinhaDupla(req.usuarioId);
    if (!minhaDupla) return res.status(400).json({ erro: 'Você precisa estar em uma dupla ativa' });

    const jaAvaliadas = await DuplaAvaliacao.findAll({
      where: { usuario_id: req.usuarioId },
      attributes: ['avaliado_dupla_id']
    });
    const idsAvaliadas = jaAvaliadas.map(a => a.avaliado_dupla_id);
    idsAvaliadas.push(minhaDupla.id);

    const duplas = await Dupla.findAll({
      where: { status: 'ativa', id: { [Op.notIn]: idsAvaliadas } },
      limit: 10
    });

    const duplasComPerfil = await Promise.all(duplas.map(async (d) => {
      const u1 = await Usuario.findByPk(d.usuario1_id, { attributes: ['id', 'nome', 'foto_url', 'data_nascimento'] });
      const u2 = await Usuario.findByPk(d.usuario2_id, { attributes: ['id', 'nome', 'foto_url', 'data_nascimento'] });
      return { id: d.id, bio_conjunta: d.bio_conjunta, membro1: u1, membro2: u2 };
    }));

    res.json({ duplas: duplasComPerfil });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao listar duplas: ' + erro.message });
  }
};

const avaliarDupla = async (req, res) => {
  try {
    const { avaliado_dupla_id, tipo } = req.body;
    const usuarioId = req.usuarioId;

    const minhaDupla = await getMinhaDupla(usuarioId);
    if (!minhaDupla) return res.status(400).json({ erro: 'Você precisa estar em uma dupla ativa' });

    const jaAvaliei = await DuplaAvaliacao.findOne({ where: { usuario_id: usuarioId, avaliado_dupla_id } });
    if (jaAvaliei) return res.status(400).json({ erro: 'Você já avaliou essa dupla' });

    await DuplaAvaliacao.create({ dupla_id: minhaDupla.id, avaliado_dupla_id, usuario_id: usuarioId, tipo });

    let match = false;
    if (tipo === 'like') {
      const parceiroId = outroMembro(minhaDupla, usuarioId);
      const parceiroTambemCurtiu = await DuplaAvaliacao.findOne({
        where: { usuario_id: parceiroId, avaliado_dupla_id, tipo: 'like' }
      });

      if (parceiroTambemCurtiu) {
        const outraDupla = await Dupla.findByPk(avaliado_dupla_id);
        if (outraDupla) {
          const membrosOutraDupla = [outraDupla.usuario1_id, outraDupla.usuario2_id];
          const avaliacoesReciprocas = await DuplaAvaliacao.findAll({
            where: { usuario_id: membrosOutraDupla, avaliado_dupla_id: minhaDupla.id, tipo: 'like' }
          });
          if (avaliacoesReciprocas.length === 2) {
            const matchExiste = await DuplaMatch.findOne({
              where: {
                [require('sequelize').Op.or]: [
                  { dupla1_id: minhaDupla.id, dupla2_id: avaliado_dupla_id },
                  { dupla1_id: avaliado_dupla_id, dupla2_id: minhaDupla.id }
                ]
              }
            });
            if (!matchExiste) {
              await DuplaMatch.create({ dupla1_id: minhaDupla.id, dupla2_id: avaliado_dupla_id });
              const membrosEnvolvidos = [minhaDupla.usuario1_id, minhaDupla.usuario2_id, outraDupla.usuario1_id, outraDupla.usuario2_id];
              for (const idMembro of membrosEnvolvidos) {
                await Notificacao.create({
                  usuario_id: idMembro,
                  tipo: 'match_dupla',
                  texto: 'Sua dupla deu um Vínculo com outra dupla!'
                });
              }
            }
            match = true;
          }
        }
      }
    }

    res.json({ mensagem: match ? 'É um Vínculo em dupla!' : 'Avaliação registrada!', match });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao avaliar: ' + erro.message });
  }
};

// ===== MATCHES E CHAT DE DUPLA =====

const listarDuplaMatches = async (req, res) => {
  try {
    const minhaDupla = await getMinhaDupla(req.usuarioId);
    if (!minhaDupla) return res.json({ matches: [] });

    const { Op } = require('sequelize');
    const matches = await DuplaMatch.findAll({
      where: {
        ativo: true,
        [Op.or]: [{ dupla1_id: minhaDupla.id }, { dupla2_id: minhaDupla.id }]
      }
    });

    const matchesComPerfil = await Promise.all(matches.map(async (m) => {
      const outraDuplaId = m.dupla1_id === minhaDupla.id ? m.dupla2_id : m.dupla1_id;
      const outraDupla = await Dupla.findByPk(outraDuplaId);
      const u1 = await Usuario.findByPk(outraDupla.usuario1_id, { attributes: ['id', 'nome', 'foto_url'] });
      const u2 = await Usuario.findByPk(outraDupla.usuario2_id, { attributes: ['id', 'nome', 'foto_url'] });
      return { id: m.id, outra_dupla: { id: outraDupla.id, membro1: u1, membro2: u2 } };
    }));

    res.json({ matches: matchesComPerfil });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao listar matches: ' + erro.message });
  }
};

const enviarMensagemDupla = async (req, res) => {
  try {
    const { dupla_match_id, conteudo } = req.body;
    const mensagem = await MensagemDupla.create({ dupla_match_id, remetente_id: req.usuarioId, conteudo });
    res.status(201).json({ mensagem: 'Mensagem enviada!', dados: mensagem });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao enviar: ' + erro.message });
  }
};

const enviarMensagemDupla = async (req, res) => {
  try {
    const { dupla_match_id, conteudo } = req.body;
    const usuarioId = req.usuarioId;

    if (!dupla_match_id || !conteudo || !String(conteudo).trim()) {
      return res.status(400).json({ erro: 'dupla_match_id e conteudo são obrigatórios' });
    }

    const minhaDupla = await getMinhaDupla(usuarioId);
    if (!minhaDupla) return res.status(403).json({ erro: 'Você precisa estar em uma dupla ativa' });

    const { Op } = require('sequelize');
    const match = await DuplaMatch.findOne({
      where: {
        id: dupla_match_id,
        ativo: true,
        [Op.or]: [{ dupla1_id: minhaDupla.id }, { dupla2_id: minhaDupla.id }]
      }
    });
    if (!match) return res.status(403).json({ erro: 'Match de dupla não encontrado ou você não faz parte dele' });

    const conteudoLimpo = String(conteudo).replace(/<[^>]*>/g, '').trim().slice(0, 2000);
    const mensagem = await MensagemDupla.create({ dupla_match_id, remetente_id: usuarioId, conteudo: conteudoLimpo });
    res.status(201).json({ mensagem: 'Mensagem enviada!', dados: mensagem });
  } catch (erro) {
    console.error('Erro ao enviar mensagem de dupla:', erro);
    res.status(500).json({ erro: 'Não foi possível enviar a mensagem.' });
  }
};

const listarMensagensDupla = async (req, res) => {
  try {
    const { dupla_match_id } = req.params;
    const usuarioId = req.usuarioId;

    const minhaDupla = await getMinhaDupla(usuarioId);
    if (!minhaDupla) return res.status(403).json({ erro: 'Você precisa estar em uma dupla ativa' });

    const { Op } = require('sequelize');
    const match = await DuplaMatch.findOne({
      where: {
        id: dupla_match_id,
        [Op.or]: [{ dupla1_id: minhaDupla.id }, { dupla2_id: minhaDupla.id }]
      }
    });
    if (!match) return res.status(403).json({ erro: 'Match de dupla não encontrado ou você não faz parte dele' });

    const mensagens = await MensagemDupla.findAll({ where: { dupla_match_id }, order: [['createdAt', 'ASC']] });
    res.json({ mensagens });
  } catch (erro) {
    console.error('Erro ao listar mensagens de dupla:', erro);
    res.status(500).json({ erro: 'Não foi possível carregar as mensagens.' });
  }
};

module.exports = {
  convidarParaDupla, listarConvitesPendentes, responderConvite, statusDupla, sairDaDupla, editarBioDupla,
  listarDuplasParaAvaliar, avaliarDupla,
  listarDuplaMatches, enviarMensagemDupla, listarMensagensDupla
};
