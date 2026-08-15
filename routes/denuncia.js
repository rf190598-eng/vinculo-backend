const express = require('express');
const router = express.Router();
const { criarDenuncia, listarDenuncias, atualizarStatusDenuncia } = require('../controllers/denunciaController');
const { autenticar } = require('../controllers/authMiddleware');
const { verificarAdmin } = require('../controllers/verificarAdmin');
const { limitarTaxa } = require('../utils/limitadorTaxa');

// Achado MENOR da auditoria: limite bem mais apertado que os outros —
// denunciar é raro em uso normal, então 5/hora por usuário dificulta usar o
// sistema de denúncia pra perseguir/derrubar outros perfis em massa.
router.post('/', autenticar, limitarTaxa({ chave: 'denuncia', porUsuario: true, janelaMs: 60 * 60 * 1000, maxTentativas: 5 }), criarDenuncia);

router.get('/', autenticar, verificarAdmin, listarDenuncias);
router.patch('/:id', autenticar, verificarAdmin, atualizarStatusDenuncia);

module.exports = router;
