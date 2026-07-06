const Usuario = require('../models/Usuario');
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

module.exports = { editarPerfil, uploadFoto, upload, atualizarLocalizacao, uploadSelfieVerificacao, estatisticasIndicacao };
