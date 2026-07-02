const express = require('express');
const router = express.Router();
const { editarPerfil, uploadFoto, upload, atualizarLocalizacao, verificarTemp } = require('../controllers/perfilController');
const { autenticar } = require('../controllers/authMiddleware');
router.put('/editar', autenticar, editarPerfil);
router.post('/foto', autenticar, upload.single('foto'), uploadFoto);
router.put('/localizacao', autenticar, atualizarLocalizacao);
router.put('/verificar-temp', autenticar, verificarTemp);