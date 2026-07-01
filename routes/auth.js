const express = require('express');
const router = express.Router();
const { cadastrar, login, perfil } = require('../controllers/authController');
const { autenticar } = require('../controllers/authMiddleware');

// Rotas públicas
router.post('/cadastrar', cadastrar);
router.post('/login', login);

// Rotas protegidas
router.get('/perfil', autenticar, perfil);

module.exports = router; 
