const express = require('express');
const router = express.Router();
const { criarDenuncia, listarDenuncias, atualizarStatusDenuncia } = require('../controllers/denunciaController');
const { autenticar } = require('../controllers/authMiddleware');

router.post('/', autenticar, criarDenuncia);

// Rotas abaixo são para o painel admin. Por ora usam o mesmo "autenticar"
// de qualquer usuário logado — antes de liberar em produção, adicione
// uma verificação extra de que quem está chamando é admin.
router.get('/', autenticar, listarDenuncias);
router.patch('/:id', autenticar, atualizarStatusDenuncia);

module.exports = router;