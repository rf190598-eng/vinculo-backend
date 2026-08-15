const express = require('express');
const router = express.Router();
const { cadastrar, login, perfil, logout } = require('../controllers/authController');
const {
  iniciarLoginGoogle,
  callbackGoogle,
  finalizarCadastroGoogle
} = require('../controllers/googleAuthController');
const { autenticar } = require('../controllers/authMiddleware');
const { limitarTaxa } = require('../utils/limitadorTaxa');

// Rotas públicas
router.post('/cadastrar', limitarTaxa({ maxTentativas: 8 }), cadastrar);
router.post('/login', limitarTaxa({ maxTentativas: 10 }), login);

// ===== Google OAuth =====
// /google e /google/callback são navegações do browser (redirect), não fetch.
// O rate limit fica só no POST final, que é o que efetivamente cria conta.
router.get('/google', iniciarLoginGoogle);
router.get('/google/callback', callbackGoogle);
router.post('/google/finalizar', limitarTaxa({ maxTentativas: 8 }), finalizarCadastroGoogle);

// Rotas protegidas
router.get('/perfil', autenticar, perfil);
router.post('/logout', autenticar, logout);

module.exports = router;
