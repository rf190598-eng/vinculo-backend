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
// 'cadastro' e 'login' têm chaves separadas de propósito (ver correção do bug
// de contador compartilhado em utils/limitadorTaxa.js). Cadastro é mais
// apertado (achado MENOR da auditoria: sem CAPTCHA/verificação de e-mail) —
// a liveness obrigatória logo depois do cadastro já barra conta falsa útil,
// então esse limite é só a primeira camada, sem exigir e-mail de confirmação.
router.post('/cadastrar', limitarTaxa({ chave: 'cadastro', janelaMs: 60 * 60 * 1000, maxTentativas: 6 }), cadastrar);
router.post('/login', limitarTaxa({ chave: 'login', maxTentativas: 10 }), login);

// ===== Google OAuth =====
// /google e /google/callback são navegações do browser (redirect), não fetch.
// O rate limit fica só no POST final, que é o que efetivamente cria conta.
router.get('/google', iniciarLoginGoogle);
router.get('/google/callback', callbackGoogle);
router.post('/google/finalizar', limitarTaxa({ chave: 'cadastro', janelaMs: 60 * 60 * 1000, maxTentativas: 6 }), finalizarCadastroGoogle);

// Rotas protegidas
router.get('/perfil', autenticar, perfil);
router.post('/logout', autenticar, logout);

module.exports = router;
