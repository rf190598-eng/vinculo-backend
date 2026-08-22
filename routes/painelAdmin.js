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
  resetarSenhaUsuario,
  excluirContaUsuario,
  obterDenunciasUsuario,
  obterSegurancaUsuario,
  obterConversasUsuario,
  obterMensagensConversaUsuario,
  obterRankingComissoes,
  obterSegmentacaoPagantes
} = require('../controllers/painelAdminController');
const { listarLogsAuditoria } = require('../controllers/auditoriaController');
const { autenticar } = require('../controllers/authMiddleware');
const { verificarAdmin } = require('../controllers/verificarAdmin');
const { limitarTaxa } = require('../utils/limitadorTaxa');

// Achado IMPORTANTE da auditoria (Área 2, item 4): nenhuma rota do Painel Admin
// tinha rate limit — com um token de admin vazado, dava pra varrer em massa
// listagem de usuários, conversas de chat, localização e selfie de liveness sem
// nenhum freio. Aplicado no nível do router (depois de autenticar+verificarAdmin,
// então já dá pra usar porUsuario) pra cobrir as 17 rotas atuais de uma vez só e
// qualquer rota nova que for adicionada aqui depois. Limite generoso (200/hora por
// admin) — não deve incomodar uso normal do painel, mas encarece muito uma
// exfiltração automatizada via token vazado. Mesma `chave` da rota de selfie de
// liveness em livenessRoutes.js (endpoint sensível equivalente, fora deste router)
// pra compartilhar o mesmo orçamento por admin.
router.use(autenticar, verificarAdmin, limitarTaxa({ chave: 'painel-admin', janelaMs: 60 * 60 * 1000, maxTentativas: 200, porUsuario: true }));
router.get('/', obterPainel);
router.get('/usuarios', listarUsuarios);
router.get('/usuarios/:id', obterUsuarioDetalhe);
router.patch('/usuarios/:id', editarUsuario);
router.post('/usuarios/:id/suspender', suspenderUsuario);
router.post('/usuarios/:id/remover-suspensao', removerSuspensaoUsuario);
router.post('/usuarios/:id/revogar-sessoes', revogarSessoesUsuario);
router.post('/usuarios/:id/resetar-senha', resetarSenhaUsuario);
router.delete('/usuarios/:id', excluirContaUsuario);
router.get('/usuarios/:id/denuncias', obterDenunciasUsuario);
router.get('/usuarios/:id/seguranca', obterSegurancaUsuario);
router.get('/usuarios/:id/conversas', obterConversasUsuario);
router.get('/usuarios/:id/conversas/:matchId/mensagens', obterMensagensConversaUsuario);
router.get('/ranking-comissoes', obterRankingComissoes);
router.get('/segmentacao-pagantes', obterSegmentacaoPagantes);
router.get('/logs-auditoria', listarLogsAuditoria);

module.exports = router;
