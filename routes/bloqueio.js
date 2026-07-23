const express = require('express');
const router = express.Router();
const { bloquearUsuario, desbloquearUsuario, listarBloqueados } = require('../controllers/bloqueioController');
const { autenticar } = require('../controllers/authMiddleware');

router.post('/', autenticar, bloquearUsuario);
router.delete('/:bloqueado_id', autenticar, desbloquearUsuario);
router.get('/', autenticar, listarBloqueados);

module.exports = router;