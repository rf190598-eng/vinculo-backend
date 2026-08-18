const express = require('express');
const router = express.Router();
const {
  obterPainel,
  listarUsuarios,
  obterUsuarioDetalhe,
  editarUsuario,
  suspenderUsuario,
  removerSuspensaoUsuario,
  revogarSessoesUsuario,
  obterRankingComissoes,
  obterSegmentacaoPagantes
} = require('../controllers/painelAdminController');
const { listarLogsAuditoria } = require('../controllers/auditoriaController');
const { autenticar } = require('../controllers/authMiddleware');
const { verificarAdmin } = require('../controllers/verificarAdmin');

router.use(autenticar, verificarAdmin);
router.get('/', obterPainel);
router.get('/usuarios', listarUsuarios);
router.get('/usuarios/:id', obterUsuarioDetalhe);
router.patch('/usuarios/:id', editarUsuario);
router.post('/usuarios/:id/suspender', suspenderUsuario);
router.post('/usuarios/:id/remover-suspensao', removerSuspensaoUsuario);
router.post('/usuarios/:id/revogar-sessoes', revogarSessoesUsuario);
router.get('/ranking-comissoes', obterRankingComissoes);
router.get('/segmentacao-pagantes', obterSegmentacaoPagantes);
router.get('/logs-auditoria', listarLogsAuditoria);

module.exports = router;
