const express = require('express');
const router = express.Router();
const {
  listarContatos, criarContato, removerContato,
  dispararPanico,
  iniciarSessao, atualizarLocalizacaoSessao, confirmarRetornoSeguro, statusSessao,
  listarSessoesParaAvaliar, criarAvaliacaoEncontro
} = require('../controllers/segurancaController');
const { autenticar } = require('../controllers/authMiddleware');

router.get('/contatos', autenticar, listarContatos);
router.post('/contatos', autenticar, criarContato);
router.delete('/contatos/:id', autenticar, removerContato);

router.post('/panico', autenticar, dispararPanico);

router.post('/sessao/iniciar', autenticar, iniciarSessao);
router.put('/sessao/localizacao', autenticar, atualizarLocalizacaoSessao);
router.post('/sessao/confirmar', autenticar, confirmarRetornoSeguro);
router.get('/sessao/status', autenticar, statusSessao);

router.get('/avaliacoes/pendentes', autenticar, listarSessoesParaAvaliar);
router.post('/avaliacoes', autenticar, criarAvaliacaoEncontro);

module.exports = router;
