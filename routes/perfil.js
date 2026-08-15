const express = require('express');
const router = express.Router();
const {
  editarPerfil, uploadFoto, upload, atualizarLocalizacao, estatisticasIndicacao,
  listarFotosGaleria, adicionarFotoGaleria, removerFotoGaleria,
  marcarTourSegurancaVisto
} = require('../controllers/perfilController');
const { autenticar } = require('../controllers/authMiddleware');

router.put('/editar', autenticar, editarPerfil);
router.post('/foto', autenticar, upload.single('foto'), uploadFoto);
router.put('/localizacao', autenticar, atualizarLocalizacao);

router.get('/indicacoes', autenticar, estatisticasIndicacao);

// Achado ALTA da auditoria de UX: registra que o usuário já viu o tour de
// segurança pós-cadastro (antes disso, a tela nunca era exibida a ninguém).
router.patch('/tour-seguranca', autenticar, marcarTourSegurancaVisto);

router.get('/galeria', autenticar, listarFotosGaleria);
router.post('/galeria', autenticar, upload.single('foto'), adicionarFotoGaleria);
router.delete('/galeria/:id', autenticar, removerFotoGaleria);

module.exports = router;
