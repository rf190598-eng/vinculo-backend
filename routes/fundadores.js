const express = require('express');
const router = express.Router();
const { cadastrar, buscarResumoPorCodigo, painelAdmin } = require('../controllers/fundadorController');
const { autenticar } = require('../controllers/authMiddleware');
const { verificarAdmin } = require('../controllers/verificarAdmin');
const { limitarTaxa } = require('../utils/limitadorTaxa');

// Público
router.post('/', limitarTaxa({ chave: 'fundadores-cadastro', janelaMs: 60 * 60 * 1000, maxTentativas: 6 }), cadastrar);
router.get('/:codigo/resumo', buscarResumoPorCodigo);

// Admin — painel simples de acompanhamento
const rotasAdmin = express.Router();
rotasAdmin.use(autenticar, verificarAdmin);
rotasAdmin.get('/', painelAdmin);

module.exports = { router, rotasAdmin };
