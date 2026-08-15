const express = require('express');
const router = express.Router();
const { enviarMensagem, listarMensagens } = require('../controllers/chatController');
const { autenticar } = require('../controllers/authMiddleware');
const { limitarTaxa } = require('../utils/limitadorTaxa');

// Achado MENOR da auditoria: rate limit específico por usuário — 60 mensagens
// a cada 10 minutos (6/min) dá folga pra conversar com várias pessoas ao
// mesmo tempo, mas barra um bot despejando mensagem em massa.
router.post('/enviar', autenticar, limitarTaxa({ chave: 'mensagem', porUsuario: true, janelaMs: 10 * 60 * 1000, maxTentativas: 60 }), enviarMensagem);
router.get('/mensagens/:match_id', autenticar, listarMensagens);

module.exports = router;
