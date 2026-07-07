const express = require('express');
const router = express.Router();
const { darSwipe, listarPerfis, listarMatches, listarCurtidasRecebidas } = require('../controllers/swipeController');
const { autenticar } = require('../controllers/authMiddleware');
router.get('/perfis', autenticar, listarPerfis);
router.post('/dar', autenticar, darSwipe);
router.get('/matches', autenticar, listarMatches);
router.get('/curtidas-recebidas', autenticar, listarCurtidasRecebidas);
module.exports = router;
