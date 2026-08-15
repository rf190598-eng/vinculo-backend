const express = require('express');
const router = express.Router();
const {
  criarSessaoLiveness,
  buscarResultadoLiveness,
  obterFotoLivenessPropria,
  obterFotoLivenessAdmin,
  migrarFotosLivenessAntigas,
} = require('../controllers/livenessController');
const { autenticar } = require('../controllers/authMiddleware');
const { verificarAdmin } = require('../controllers/verificarAdmin');

router.post('/sessao', autenticar, criarSessaoLiveness);
router.get('/resultado/:sessionId', autenticar, buscarResultadoLiveness);

// Correção do achado CRÍTICO 1 da auditoria: a foto de referência do liveness não
// é mais servida como arquivo estático público — só por aqui, com dono checado.
router.get('/referencia', autenticar, obterFotoLivenessPropria);
router.get('/referencia/:usuarioId', autenticar, verificarAdmin, obterFotoLivenessAdmin);

// Migração única dos registros antigos (fotos que ainda estão na pasta pública
// de antes desta correção). Rota protegida por admin, idempotente — pode ser
// chamada mais de uma vez sem problema, e é seguro deixá-la no ar depois de usada.
router.post('/migrar-fotos-antigas', autenticar, verificarAdmin, migrarFotosLivenessAntigas);

module.exports = router;
