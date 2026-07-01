const express = require('express');
const router = express.Router();
const { enviarMensagem, listarMensagens } = require('../controllers/chatController');
const { autenticar } = require('../controllers/authMiddleware');

router.post('/enviar', autenticar, enviarMensagem);
router.get('/mensagens/:match_id', autenticar, listarMensagens);

module.exports = router; 
