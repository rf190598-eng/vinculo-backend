const express = require('express');
const router = express.Router();
const { criarPagamentoPix, criarAssinaturaCartao, cancelarAssinaturaCartao, obterMinhaAssinatura, webhook, verificarPremium } = require('../controllers/pagamentoController');
const { autenticar } = require('../controllers/authMiddleware');

// Rotas protegidas
router.post('/pix', autenticar, criarPagamentoPix);
router.post('/assinatura-cartao', autenticar, criarAssinaturaCartao);
// Sempre pelo req.usuarioId da sessão — nunca aceita id vindo do corpo, então
// ninguém consegue cancelar a assinatura de outra pessoa.
router.post('/cancelar-assinatura', autenticar, cancelarAssinaturaCartao);
router.get('/minha-assinatura', autenticar, obterMinhaAssinatura);
router.get('/status', autenticar, verificarPremium);

// Webhook do Mercado Pago (público)
router.post('/webhook', webhook);

module.exports = router; 
