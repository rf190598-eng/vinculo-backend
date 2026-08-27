const express = require('express');
const router = express.Router();
const { darSwipe, listarPerfis, listarMatches, listarCurtidasRecebidas, obterPerfilMatch } = require('../controllers/swipeController');
const { autenticar } = require('../controllers/authMiddleware');
const { limitarTaxa } = require('../utils/limitadorTaxa');
router.get('/perfis', autenticar, listarPerfis);
// Achado MENOR da auditoria: rate limit específico, mais generoso que o
// genérico (300/15min por IP) porque swipe/curtida legítima pode vir em
// rajada — 400/hora por usuário cobre até sessão intensa sem atrapalhar.
router.post('/dar', autenticar, limitarTaxa({ chave: 'swipe', porUsuario: true, janelaMs: 60 * 60 * 1000, maxTentativas: 400 }), darSwipe);
router.get('/matches', autenticar, listarMatches);
router.get('/curtidas-recebidas', autenticar, listarCurtidasRecebidas);
router.get('/perfil-match/:id', autenticar, obterPerfilMatch);
module.exports = router;
