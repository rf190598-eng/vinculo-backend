const Usuario = require('../models/Usuario');
const FotoPerfil = require('../models/FotoPerfil');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const pasta = 'uploads/';
    if (!fs.existsSync(pasta)) {
      fs.mkdirSync(pasta, { recursive: true });
    }
    cb(null, pasta);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, req.usuarioId + '-' + Date.now() + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const tipos = /jpeg|jpg|png/;
    const valido = tipos.test(file.mimetype);
    if (valido) cb(null, true);
    else cb(new Error('Apenas imagens JPG e PNG são permitidas'));
  }
});

const editarPerfil = async (req, res) => {
  try {
    const { nome, bio, genero, data_nascimento, cidade, objetivo, signo } = req.body;
    const usuario_id = req.usuarioId;
    const dados = {};
    if (nome) dados.nome = nome;
    if (bio) dados.bio = bio;
    if (genero) dados.genero = genero;
    if (data_nascimento) dados.data_nascimento = data_nascimento;
    if (cidade) dados.cidade = cidade;
    if (objetivo) dados.objetivo = objetivo;
    if (signo) dados.signo = signo;
    await Usuario.update(dados, { where: { id: usuario_id } });
    const usuario = await Usuario.findByPk(usuario_id, {
      attributes: { exclude: ['senha', 'foto_verificacao'] }
    });
    res.json({ mensagem: 'Perfil atualizado!', usuario });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao editar perfil: ' + erro.message });
  }
};

const uploadFoto = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ erro: 'Nenhuma foto enviada' });
    }
    const foto_url = '/uploads/' + req.file.filename;
    await Usuario.update(
      { foto_url },
      { where: { id: req.usuarioId } }
    );
    res.json({ mensagem: 'Foto atualizada com sucesso!', foto_url });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao fazer upload: ' + erro.message });
  }
};

const uploadSelfieVerificacao = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ erro: 'Nenhuma selfie enviada' });
    }
    const foto_verificacao = '/uploads/' + req.file.filename;
    await Usuario.update(
      { foto_verificacao, verificado: true },
      { where: { id: req.usuarioId } }
    );

    const usuarioVerificado = await Usuario.findByPk(req.usuarioId);
    if (usuarioVerificado.indicado_por && !usuarioVerificado.bonus_indicacao_creditado) {
      const referenciador = await Usuario.findOne({ where: { codigo_indicacao: usuarioVerificado.indicado_por } });
      if (referenciador) {
        const agora = new Date();
        const baseAtual = (referenciador.premium && referenciador.premium_ate && new Date(referenciador.premium_ate) > agora)
          ? new Date(referenciador.premium_ate)
          : agora;
        const novoPremiumAte = new Date(baseAtual.getTime() + 7 * 24 * 60 * 60 * 1000);
        await Usuario.update(
          { premium: true, premium_ate: novoPremiumAte },
          { where: { id: referenciador.id } }
        );
        await Usuario.update(
          { bonus_indicacao_creditado: true },
          { where: { id: usuarioVerificado.id } }
        );
      }
    }

    const usuario = await Usuario.findByPk(req.usuarioId, {
      attributes: { exclude: ['senha', 'foto_verificacao'] }
    });
    res.json({ mensagem: 'Perfil verificado!', usuario });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao verificar: ' + erro.message });
  }
};

const atualizarLocalizacao = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    await Usuario.update(
      { latitude, longitude },
      { where: { id: req.usuarioId } }
    );
    res.json({ mensagem: 'Localização atualizada!' });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao atualizar localização: ' + erro.message });
  }
};

const estatisticasIndicacao = async (req, res) => {
  try {
    const usuario = await Usuario.findByPk(req.usuarioId);
    const indicados = await Usuario.findAll({
      where: { indicado_por: usuario.codigo_indicacao },
      attributes: ['id', 'nome', 'verificado', 'createdAt']
    });
    const verificados = indicados.filter(i => i.verificado).length;
    res.json({
      codigo_indicacao: usuario.codigo_indicacao,
      total_indicados: indicados.length,
      indicados_verificados: verificados,
      dias_premium_ganhos: verificados * 7
    });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao buscar indicações: ' + erro.message });
  }
};

const MAX_FOTOS_GALERIA = 7;

const listarFotosGaleria = async (req, res) => {
  try {
    const fotos = await FotoPerfil.findAll({
      where: { usuario_id: req.usuarioId },
      order: [['ordem', 'ASC']]
    });
    res.json({ fotos, limite: MAX_FOTOS_GALERIA });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao listar fotos: ' + erro.message });
  }
};

const adicionarFotoGaleria = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ erro: 'Nenhuma foto enviada' });
    }
    const totalAtual = await FotoPerfil.count({ where: { usuario_id: req.usuarioId } });
    if (totalAtual >= MAX_FOTOS_GALERIA) {
      return res.status(400).json({ erro: `Você já tem o máximo de ${MAX_FOTOS_GALERIA} fotos` });
    }

    const url = '/uploads/' + req.file.filename;
    const foto = await FotoPerfil.create({ usuario_id: req.usuarioId, url, ordem: totalAtual });

    if (totalAtual === 0) {
      await Usuario.update({ foto_url: url }, { where: { id: req.usuarioId } });
    }

    res.status(201).json({ mensagem: 'Foto adicionada!', foto, total: totalAtual + 1 });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao adicionar foto: ' + erro.message });
  }
};

const removerFotoGaleria = async (req, res) => {
  try {
    const { id } = req.params;
    const foto = await FotoPerfil.findOne({ where: { id, usuario_id: req.usuarioId } });
    if (!foto) return res.status(404).json({ erro: 'Foto não encontrada' });

    const eraOrdemZero = foto.ordem === 0;
    await foto.destroy();

    const restantes = await FotoPerfil.findAll({
      where: { usuario_id: req.usuarioId },
      order: [['ordem', 'ASC']]
    });
    for (let i = 0; i < restantes.length; i++) {
      if (restantes[i].ordem !== i) {
        restantes[i].ordem = i;
        await restantes[i].save();
      }
    }

    if (eraOrdemZero) {
      const novaPrimeira = restantes[0];
      await Usuario.update(
        { foto_url: novaPrimeira ? novaPrimeira.url : null },
        { where: { id: req.usuarioId } }
      );
    }

    res.json({ mensagem: 'Foto removida!' });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao remover foto: ' + erro.message });
  }
};

module.exports = {
  editarPerfil, uploadFoto, upload, atualizarLocalizacao, uploadSelfieVerificacao, estatisticasIndicacao,
  listarFotosGaleria, adicionarFotoGaleria, removerFotoGaleria
};
