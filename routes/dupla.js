const express = require('express');
const router = express.Router();
const {
  convidarParaDupla, listarConvitesPendentes, responderConvite, statusDupla, sairDaDupla, editarBioDupla,
  listarDuplasParaAvaliar, avaliarDupla,
  listarDuplaMatches, enviarMensagemDupla, listarMensagensDupla
} = require('../controllers/duplaController');
const { autenticar } = require('../controllers/authMiddleware');

router.post('/convidar', autenticar, convidarParaDupla);
router.get('/convites', autenticar, listarConvitesPendentes);
router.post('/:dupla_id/responder', autenticar, responderConvite);
router.get('/status', autenticar, statusDupla);
router.post('/sair', autenticar, sairDaDupla);
router.put('/bio', autenticar, editarBioDupla);

router.get('/perfis', autenticar, listarDuplasParaAvaliar);
router.post('/avaliar', autenticar, avaliarDupla);

router.get('/matches', autenticar, listarDuplaMatches);
router.post('/mensagem', autenticar, enviarMensagemDupla);
router.get('/mensagens/:dupla_match_id', autenticar, listarMensagensDupla);

module.exports = router;
