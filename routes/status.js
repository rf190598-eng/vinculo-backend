const express = require('express');
const router = express.Router();
const { obterPerguntaDoDia, criarResposta, listarStatusFeed, meuStatusAtivo, uploadStatus } = require('../controllers/statusController');
const { autenticar } = require('../controllers/authMiddleware');

router.get('/pergunta-do-dia', autenticar, obterPerguntaDoDia);
router.post('/', autenticar, uploadStatus.single('arquivo'), criarResposta);
router.get('/feed', autenticar, listarStatusFeed);
router.get('/meu', autenticar, meuStatusAtivo);

module.exports = router;
