const express = require('express');
const router = express.Router();
const { solicitarRecuperacao, redefinirSenha } = require('../controllers/recuperacaoSenhaController');

router.post('/esqueci-senha', solicitarRecuperacao);
router.post('/redefinir-senha', redefinirSenha);

module.exports = router;