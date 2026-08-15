const express = require('express');
const router = express.Router();
const { criarPagamentoPix, criarAssinaturaCartao, webhook, verificarPremium } = require('../controllers/pagamentoController');
const { autenticar } = require('../controllers/authMiddleware');

// Rotas protegidas
router.post('/pix', autenticar, criarPagamentoPix);
router.post('/assinatura-cartao', autenticar, criarAssinaturaCartao);
router.get('/status', autenticar, verificarPremium);

// Webhook do Mercado Pago (público)
router.post('/webhook', webhook);

module.exports = router; 
