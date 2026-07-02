const Usuario = require('../models/Usuario');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configurar upload de foto
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, req.usuarioId + '-' + Date.now() + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const tipos = /jpeg|jpg|png/;
    const valido = tipos.test(file.mimetype);
    if (valido) cb(null, true);
    else cb(new Error('Apenas imagens JPG e PNG são permitidas'));
  }
});

const editarPerfil = async (req, res) => {
  try {
   const { nome, bio, genero, data_nascimento, cidade, objetivo } = req.body;
    const usuario_id = req.usuarioId;
    const dados = {};
    if (nome) dados.nome = nome;
    if (bio) dados.bio = bio;
    if (genero) dados.genero = genero;
    if (data_nascimento) dados.data_nascimento = data_nascimento;
    if (cidade) dados.cidade = cidade;
    if (objetivo) dados.objetivo = objetivo;
    await Usuario.update(dados, { where: { id: usuario_id } });

    const usuario = await Usuario.findByPk(usuario_id, {
      attributes: { exclude: ['senha'] }
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

    res.json({
      mensagem: 'Foto atualizada com sucesso!',
      foto_url
    });

  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao fazer upload: ' + erro.message });
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

const verificarTemp = async (req, res) => {
  try {
    await Usuario.update({ verificado: true }, { where: { id: req.usuarioId } });
    const usuario = await Usuario.findByPk(req.usuarioId, { attributes: { exclude: ['senha'] } });
    res.json({ mensagem: 'Perfil verificado!', usuario });
  } catch (erro) {
    res.status(500).json({ erro: 'Erro ao verificar: ' + erro.message });
  }
};

module.exports = { editarPerfil, uploadFoto, upload, atualizarLocalizacao, verificarTemp };