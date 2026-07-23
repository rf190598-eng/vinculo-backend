const express = require('express');
const router = express.Router();
const { criarSolicitacao, listarSolicitacoes } = require('../controllers/parceriaController');
const { autenticar } = require('../controllers/authMiddleware');

router.post('/', autenticar, criarSolicitacao);
router.get('/', autenticar, listarSolicitacoes);

module.exports = router;
