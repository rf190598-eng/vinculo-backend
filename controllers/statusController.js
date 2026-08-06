const StatusResposta = require('../models/StatusResposta');
const Usuario = require('../models/Usuario');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

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
    cb(null, crypto.randomUUID() + ext);
  }
});

// Tipos aceitos num status/story. Lista EXPLÍCITA em vez da regex solta de
// antes (/jpeg|jpg|png|mp4|quicktime|webm|mov/), que casava a substring em
// qualquer posição do mimetype e por isso também aceitava coisas não
// pretendidas (ex: 'application/mp4', 'audio/webm' — áudio puro sem vídeo).
const MIMETYPES_STATUS_PERMITIDOS = [
  'image/jpeg',
  'image/jpg',   // não é oficial, mas alguns clientes/navegadores mandam assim
  'image/png',
  'video/mp4',       // Safari/iPhone (e fallback do MediaRecorder em alguns Androids)
  'video/webm',      // Chrome/Firefox — formato padrão do MediaRecorder do composer
  'video/quicktime'  // .mov gravado nativamente pelo iPhone e enviado pela galeria
];

// A comparação NÃO pode ser igualdade de string: o MediaRecorder do navegador
// devolve o mimetype com os codecs anexados como parâmetro
// (ex: 'video/webm;codecs=vp9,opus' ou 'video/webm;codecs=vp8,opus'), que é
// exatamente o valor que o front usa ao montar o File enviado. Então aceitamos
// o tipo base exato OU o tipo base seguido de ';' + parâmetros. Continua sendo
// estrito o bastante pra não deixar passar 'video/mp4x' e afins.
const mimetypeStatusPermitido = (mimetype) => {
  const limpo = String(mimetype || '').trim().toLowerCase();
  return MIMETYPES_STATUS_PERMITIDOS.some(
    (tipo) => limpo === tipo || limpo.startsWith(tipo + ';')
  );
};

const uploadStatus = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (mimetypeStatusPermitido(file.mimetype)) return cb(null, true);
    // Loga o mimetype recusado: sem isso não dá pra saber DEPOIS o que o
    // navegador do usuário mandou de verdade (em produção o handler global do
    // index.js troca a mensagem do erro por 'Erro interno do servidor').
    console.warn('[status] upload recusado — mimetype recebido:', file.mimetype, '| arquivo:', file.originalname);
    cb(new Error('Formato de arquivo nao suportado: ' + file.mimetype));
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
    const { tipo, conteudo_texto, overlays_texto } = req.body;
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
    const textoLimpo = tipo === 'texto'
      ? String(conteudo_texto).replace(/<[^>]*>/g, '').trim().slice(0, 300)
      : null;

    // Caixas de texto posicionadas sobre um vídeo (editor de story). Não faz
    // sentido pra foto/texto, já que nesses casos o texto já vem "queimado"
    // na própria imagem enviada. Validado/saneado aqui pra nunca guardar lixo —
    // "fonte" é validada contra uma whitelist (não contra regex) porque esse
    // valor vai direto pra dentro de um atributo style no HTML na hora de
    // exibir (renderizarOverlaysTextoStory), então uma string arbitrária aqui
    // seria uma forma de quebrar o style attribute.
    const FONTES_OVERLAY_PERMITIDAS = [
      "'Cormorant Garamond', serif",
      "'Karla', sans-serif",
      "'Poppins', sans-serif",
      "'Caveat', cursive"
    ];
    let overlaysValidados = null;
    if (tipo === 'video' && overlays_texto) {
      try {
        const parsed = JSON.parse(overlays_texto);
        if (Array.isArray(parsed)) {
          overlaysValidados = parsed.slice(0, 20).map(o => ({
            texto: String(o.texto || '').replace(/<[^>]*>/g, '').slice(0, 200),
            cor: /^#[0-9a-fA-F]{3,8}$/.test(o.cor) ? o.cor : '#fdf6f2',
            fonte: FONTES_OVERLAY_PERMITIDAS.includes(o.fonte) ? o.fonte : FONTES_OVERLAY_PERMITIDAS[0],
            tamanhoFonte: Number.isFinite(o.tamanhoFonte) ? Math.max(10, Math.min(96, o.tamanhoFonte)) : 28,
            fundo: !!o.fundo,
            x: Number.isFinite(o.x) ? Math.max(0, Math.min(100, o.x)) : 50,
            y: Number.isFinite(o.y) ? Math.max(0, Math.min(100, o.y)) : 50,
            rot: Number.isFinite(o.rot) ? o.rot : 0,
            escala: Number.isFinite(o.escala) ? Math.max(0.2, Math.min(5, o.escala)) : 1
          })).filter(o => o.texto);
          if (!overlaysValidados.length) overlaysValidados = null;
        }
      } catch (erroParse) {
        overlaysValidados = null;
      }
    }

    const resposta = await StatusResposta.create({
      usuario_id: req.usuarioId,
      tipo,
      conteudo_texto: textoLimpo,
      media_url,
      pergunta_texto: pergunta,
      expira_em,
      overlays_texto: overlaysValidados
    });

    res.status(201).json({ mensagem: 'Status publicado!', resposta });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao publicar status: ' + erro.message });
  }
};

// Agrupa por usuário: cada pessoa aparece uma vez na barra, mas carrega TODOS
// os stories ativos dela (não substituídos ao postar de novo, só filtrados
// por expira_em). Ordena os stories de cada pessoa do mais antigo pro mais
// novo (pra navegação avançar cronologicamente, igual Instagram), e ordena as
// pessoas pelo story mais recente delas primeiro (mesmo critério de antes).
const listarStatusFeed = async (req, res) => {
  try {
    const { Op } = require('sequelize');
    const respostas = await StatusResposta.findAll({
      where: {
        usuario_id: { [Op.ne]: req.usuarioId },
        expira_em: { [Op.gt]: new Date() }
      },
      order: [['createdAt', 'ASC']]
    });

    const porUsuario = new Map();
    for (const r of respostas) {
      if (!porUsuario.has(r.usuario_id)) porUsuario.set(r.usuario_id, []);
      porUsuario.get(r.usuario_id).push({
        id: r.id, tipo: r.tipo, conteudo_texto: r.conteudo_texto, media_url: r.media_url,
        pergunta_texto: r.pergunta_texto, overlays_texto: r.overlays_texto, createdAt: r.createdAt
      });
    }

    const feed = [];
    for (const [usuario_id, stories] of porUsuario) {
      const usuario = await Usuario.findByPk(usuario_id, { attributes: ['id', 'nome', 'foto_url'] });
      feed.push({ usuario, stories });
    }
    feed.sort((a, b) => new Date(b.stories[b.stories.length - 1].createdAt) - new Date(a.stories[a.stories.length - 1].createdAt));

    res.json({ feed });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao listar status: ' + erro.message });
  }
};

// Retorna a LISTA de stories ativos do próprio usuário (do mais antigo pro
// mais novo), não só o último — postar de novo agora soma à lista, não troca.
const meuStatusAtivo = async (req, res) => {
  try {
    const { Op } = require('sequelize');
    const respostas = await StatusResposta.findAll({
      where: { usuario_id: req.usuarioId, expira_em: { [Op.gt]: new Date() } },
      order: [['createdAt', 'ASC']]
    });

    if (!respostas.length) return res.json({ stories: [] });

    const usuario = await Usuario.findByPk(req.usuarioId, { attributes: ['id', 'nome', 'foto_url'] });
    const stories = respostas.map(status => ({
      id: status.id, tipo: status.tipo, conteudo_texto: status.conteudo_texto, media_url: status.media_url,
      pergunta_texto: status.pergunta_texto, overlays_texto: status.overlays_texto, createdAt: status.createdAt
    }));
    res.json({ stories, usuario });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao buscar seus stories: ' + erro.message });
  }
};

module.exports = { obterPerguntaDoDia, criarResposta, listarStatusFeed, meuStatusAtivo, uploadStatus };
