const StatusResposta = require('../models/StatusResposta');
const Usuario = require('../models/Usuario');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const PERGUNTAS = [
  'Qual foi o lugar mais bonito que voce ja visitou?',
  'Qual e o seu prato favorito pra cozinhar ou pedir?',
  'Qual serie ou filme voce ja assistiu mais de 3 vezes?',
  'Praia, campo ou cidade grande?',
  'Qual foi a ultima coisa que te fez rir muito?',
  'Cafe da manha, almoco ou jantar - qual refeicao voce mais ama?',
  'Qual musica nao pode faltar na sua playlist?',
  'Voce prefere planejar tudo ou viajar sem roteiro?',
  'Qual e o seu fim de semana ideal?',
  'Um talento seu que poucas pessoas conhecem?',
  'Qual foi a melhor viagem que voce ja fez?',
  'Cachorro, gato, ou nenhum dos dois?',
  'Manha ou noite - quando voce rende mais?',
  'Qual hobby voce queria ter mais tempo pra praticar?',
  'Uma comida que voce nunca vai enjoar?',
  'Qual foi o show ou evento mais marcante que voce foi?',
  'Se pudesse morar em outra cidade, qual seria?',
  'Qual conselho voce daria pro seu eu de 18 anos?',
  'Time, esporte ou nenhum dos dois?',
  'O que mais te deixa animado essa semana?'
];

function getPerguntaDoDia() {
  const hoje = new Date();
  const diaDoAno = Math.floor((hoje - new Date(hoje.getFullYear(), 0, 0)) / 86400000);
  return PERGUNTAS[diaDoAno % PERGUNTAS.length];
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const pasta = 'uploads/';
    if (!fs.existsSync(pasta)) fs.mkdirSync(pasta, { recursive: true });
    cb(null, pasta);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, 'status-' + req.usuarioId + '-' + Date.now() + ext);
  }
});

const uploadStatus = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const tiposValidos = /jpeg|jpg|png|mp4|quicktime|webm|mov/;
    const valido = tiposValidos.test(file.mimetype);
    if (valido) cb(null, true);
    else cb(new Error('Formato de arquivo nao suportado'));
  }
});

const obterPerguntaDoDia = async (req, res) => {
  try {
    const pergunta = getPerguntaDoDia();
    const agora = new Date();
    const jaRespondi = await StatusResposta.findOne({
      where: { usuario_id: req.usuarioId, pergunta_texto: pergunta },
      order: [['createdAt', 'DESC']]
    });
    const respondiHoje = jaRespondi && new Date(jaRespondi.expira_em) > agora;
    res.json({ pergunta, ja_respondi: !!respondiHoje });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao buscar pergunta: ' + erro.message });
  }
};

const criarResposta = async (req, res) => {
  try {
    const { tipo, conteudo_texto } = req.body;
    if (!['foto', 'video', 'texto'].includes(tipo)) {
      return res.status(400).json({ erro: 'Tipo invalido' });
    }
    if (tipo === 'texto' && !conteudo_texto) {
      return res.status(400).json({ erro: 'Escreva uma resposta em texto' });
    }
    if ((tipo === 'foto' || tipo === 'video') && !req.file) {
      return res.status(400).json({ erro: 'Envie um arquivo de ' + tipo });
    }

    const pergunta = getPerguntaDoDia();
    const expira_em = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const media_url = req.file ? '/uploads/' + req.file.filename : null;

    const resposta = await StatusResposta.create({
      usuario_id: req.usuarioId,
      tipo,
      conteudo_texto: tipo === 'texto' ? conteudo_texto : null,
      media_url,
      pergunta_texto: pergunta,
      expira_em
    });

    res.status(201).json({ mensagem: 'Status publicado!', resposta });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao publicar status: ' + erro.message });
  }
};

const listarStatusFeed = async (req, res) => {
  try {
    const { Op } = require('sequelize');
    const respostas = await StatusResposta.findAll({
      where: {
        usuario_id: { [Op.ne]: req.usuarioId },
        expira_em: { [Op.gt]: new Date() }
      },
      order: [['createdAt', 'DESC']]
    });

    const vistos = new Set();
    const feed = [];
    for (const r of respostas) {
      if (vistos.has(r.usuario_id)) continue;
      vistos.add(r.usuario_id);
      const usuario = await Usuario.findByPk(r.usuario_id, { attributes: ['id', 'nome', 'foto_url'] });
      feed.push({
        id: r.id, tipo: r.tipo, conteudo_texto: r.conteudo_texto, media_url: r.media_url,
        pergunta_texto: r.pergunta_texto, usuario
      });
    }
    res.json({ feed });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao listar status: ' + erro.message });
  }
};

module.exports = { obterPerguntaDoDia, criarResposta, listarStatusFeed, uploadStatus };
