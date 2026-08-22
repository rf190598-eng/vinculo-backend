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
const { limitarTaxa } = require('../utils/limitadorTaxa');

router.post('/sessao', autenticar, criarSessaoLiveness);
router.get('/resultado/:sessionId', autenticar, buscarResultadoLiveness);

// Correção do achado CRÍTICO 1 da auditoria: a foto de referência do liveness não
// é mais servida como arquivo estático público — só por aqui, com dono checado.
router.get('/referencia', autenticar, obterFotoLivenessPropria);
// Achado IMPORTANTE da auditoria (Área 2, item 4): rota admin de selfie sem rate
// limit — fica fora do router de painelAdmin.js, então recebe o limite aqui
// diretamente. Mesma `chave` ('painel-admin') do router do painel, pra
// compartilhar um único orçamento por admin em vez de dois limites separados.
router.get('/referencia/:usuarioId', autenticar, verificarAdmin, limitarTaxa({ chave: 'painel-admin', janelaMs: 60 * 60 * 1000, maxTentativas: 200, porUsuario: true }), obterFotoLivenessAdmin);

// Migração única dos registros antigos (fotos que ainda estão na pasta pública
// de antes desta correção). Rota protegida por admin, idempotente — pode ser
// chamada mais de uma vez sem problema, e é seguro deixá-la no ar depois de usada.
// Mesma `chave` de rate limit das outras rotas admin sensíveis, por consistência.
router.post('/migrar-fotos-antigas', autenticar, verificarAdmin, limitarTaxa({ chave: 'painel-admin', janelaMs: 60 * 60 * 1000, maxTentativas: 200, porUsuario: true }), migrarFotosLivenessAntigas);

module.exports = router;
