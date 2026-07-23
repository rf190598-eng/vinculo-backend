const express = require('express');
const router = express.Router();
const {
  editarPerfil, uploadFoto, upload, atualizarLocalizacao, uploadSelfieVerificacao, estatisticasIndicacao,
  listarFotosGaleria, adicionarFotoGaleria, removerFotoGaleria
} = require('../controllers/perfilController');
const { autenticar } = require('../controllers/authMiddleware');

router.put('/editar', autenticar, editarPerfil);
router.post('/foto', autenticar, upload.single('foto'), uploadFoto);
router.put('/localizacao', autenticar, atualizarLocalizacao);
router.post('/selfie-verificacao', autenticar, upload.single('foto'), uploadSelfieVerificacao);
router.get('/indicacoes', autenticar, estatisticasIndicacao);

router.get('/galeria', autenticar, listarFotosGaleria);
router.post('/galeria', autenticar, upload.single('foto'), adicionarFotoGaleria);
router.delete('/galeria/:id', autenticar, removerFotoGaleria);

module.exports = router;
