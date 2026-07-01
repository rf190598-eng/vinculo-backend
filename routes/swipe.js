const express = require('express');
const router = express.Router();
const { darSwipe, listarPerfis, listarMatches } = require('../controllers/swipeController');
const { autenticar } = require('../controllers/authMiddleware');

// Todas as rotas precisam de autenticação
router.get('/perfis', autenticar, listarPerfis);
router.post('/dar', autenticar, darSwipe);
router.get('/matches', autenticar, listarMatches);

module.exports = router; 
