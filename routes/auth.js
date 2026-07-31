const express = require('express');
const router = express.Router();
const { cadastrar, login, perfil } = require('../controllers/authController');
const { autenticar } = require('../controllers/authMiddleware');
const { limitarTaxa } = require('../utils/limitadorTaxa');

// Rotas públicas
router.post('/cadastrar', limitarTaxa({ maxTentativas: 8 }), cadastrar);
router.post('/login', limitarTaxa({ maxTentativas: 10 }), login);

// Rotas protegidas
router.get('/perfil', autenticar, perfil);

module.exports = router;
