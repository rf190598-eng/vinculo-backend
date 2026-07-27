const express = require('express');
const router = express.Router();
const { criarSessaoLiveness, buscarResultadoLiveness } = require('../controllers/livenessController');
const { autenticar } = require('../controllers/authMiddleware');

router.post('/sessao', autenticar, criarSessaoLiveness);
router.get('/resultado/:sessionId', autenticar, buscarResultadoLiveness);

module.exports = router;
