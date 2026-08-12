const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const {
  listarContatos, criarContato, removerContato,
  dispararPanico,
  iniciarSessao, atualizarLocalizacaoSessao, confirmarRetornoSeguro, statusSessao,
  listarSessoesParaAvaliar, criarAvaliacaoEncontro
} = require('../controllers/segurancaController');
const { autenticar } = require('../controllers/authMiddleware');

// Contato de confiança recebe alertas reais de pânico/check-in — limita
// tentativas de cadastro por usuário (não por IP) pra evitar abuso sem
// travar quem só está tentando corrigir um número digitado errado.
const limiteContatos = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 10,
  message: { erro: 'Muitas tentativas de cadastro de contato. Tente novamente mais tarde.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.usuarioId || req.ip
});

router.get('/contatos', autenticar, listarContatos);
router.post('/contatos', autenticar, limiteContatos, criarContato);
router.delete('/contatos/:id', autenticar, removerContato);

router.post('/panico', autenticar, dispararPanico);

router.post('/sessao/iniciar', autenticar, iniciarSessao);
router.put('/sessao/localizacao', autenticar, atualizarLocalizacaoSessao);
router.post('/sessao/confirmar', autenticar, confirmarRetornoSeguro);
router.get('/sessao/status', autenticar, statusSessao);

router.get('/avaliacoes/pendentes', autenticar, listarSessoesParaAvaliar);
router.post('/avaliacoes', autenticar, criarAvaliacaoEncontro);

module.exports = router;
