const express = require('express');
const router = express.Router();
const { criarSolicitacao, listarSolicitacoes } = require('../controllers/parceriaController');
const { autenticar } = require('../controllers/authMiddleware');
const { verificarAdmin } = require('../controllers/verificarAdmin');

router.post('/', autenticar, criarSolicitacao);
router.get('/', autenticar, verificarAdmin, listarSolicitacoes);

module.exports = router;
