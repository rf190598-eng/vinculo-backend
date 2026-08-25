const express = require('express');
const router = express.Router();
const { enviarMensagem } = require('../controllers/vicController');
const { autenticar } = require('../controllers/authMiddleware');
const { limitarTaxa } = require('../utils/limitadorTaxa');

// 30/hora por usuário: cada mensagem tem custo real de API (Haiku 4.5 =
// US$1/M tokens de entrada, US$5/M de saída) — combinado com o teto de
// max_tokens e o corte de histórico no controller, mantém o pior caso de
// gasto por usuário na casa de centavos por hora, não dólares.
router.post('/mensagem', autenticar, limitarTaxa({ chave: 'vic-mensagem', porUsuario: true, janelaMs: 60 * 60 * 1000, maxTentativas: 30 }), enviarMensagem);

module.exports = router;
