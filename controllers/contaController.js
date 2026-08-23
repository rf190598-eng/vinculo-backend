const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { sequelize } = require('../database');

const Usuario = require('../models/Usuario');
const Swipe = require('../models/Swipe');
const Match = require('../models/Match');
const Mensagem = require('../models/Mensagem');
const Dupla = require('../models/Dupla');
const DuplaMatch = require('../models/DuplaMatch');
const DuplaAvaliacao = require('../models/DuplaAvaliacao');
const MensagemDupla = require('../models/MensagemDupla');
const VisualizacaoPerfil = require('../models/VisualizacaoPerfil');
const Notificacao = require('../models/Notificacao');
const StatusResposta = require('../models/StatusResposta');
const FotoPerfil = require('../models/FotoPerfil');
const ContatoConfianca = require('../models/ContatoConfianca');
const EventoConfirmacao = require('../models/EventoConfirmacao');
const AvaliacaoEncontro = require('../models/AvaliacaoEncontro');
const AlertaSeguranca = require('../models/AlertaSeguranca');
const SessaoSeguranca = require('../models/SessaoSeguranca');
const Denuncia = require('../models/Denuncia');
const Bloqueio = require('../models/Bloqueio');
const SolicitacaoParceria = require('../models/SolicitacaoParceria');
const Parceiro = require('../models/Parceiro');
const Indicacao = require('../models/Indicacao');
const Comissao = require('../models/Comissao');
const BonusMeta = require('../models/BonusMeta');
const { caminhoArquivoLiveness } = require('./livenessController');

// Lançado dentro da cascata quando a regra de negócio impede a exclusão
// (ex: comissões pendentes do Programa de Parceiros) — distinto de um erro
// inesperado, pra quem chama poder devolver 409 com mensagem clara em vez
// do 500 genérico.
class ExclusaoContaBloqueada extends Error {}

// Apaga um arquivo físico de /uploads de forma silenciosa (ignora se já não existir).
function apagarArquivoUpload(urlRelativa) {
  if (!urlRelativa) return;
  const caminho = path.join(__dirname, '..', urlRelativa.replace(/^\//, ''));
  fs.unlink(caminho, (erro) => {
    if (erro && erro.code !== 'ENOENT') {
      console.error('Erro ao apagar arquivo de upload:', caminho, erro.message);
    }
  });
}

// Apaga a foto de referência do liveness (pasta privada — ver livenessController).
// Antes esta exclusão tentava apagar usuario.foto_verificacao, um campo que nunca é
// preenchido em nenhum lugar do código — ou seja, nunca apagava nada de verdade.
// A selfie de verificação de identidade ficava para sempre no disco mesmo depois da
// exclusão de conta. Corrigido pra apagar o arquivo real (achado MENOR da auditoria).
function apagarArquivoLivenessSeExistir(valorSalvo) {
  const caminho = caminhoArquivoLiveness(valorSalvo);
  if (!caminho) return;
  fs.unlink(caminho, (erro) => {
    if (erro && erro.code !== 'ENOENT') {
      console.error('Erro ao apagar foto de liveness:', caminho, erro.message);
    }
  });
}

// Cascata de exclusão de conta — extraída pra ser reaproveitada tanto pelo
// autoatendimento (excluirConta, logo abaixo, exige a senha do próprio
// usuário) quanto pela variante admin (painelAdminController.
// excluirContaUsuario, Lote 6 do plano de acesso total, exige motivo +
// confirmação por e-mail em vez de senha). Mantém EXATAMENTE a mesma ordem
// e lógica de sempre — só parametrizada por usuario/transação, e devolve o
// que falta apagar em disco depois do commit (quem chama só apaga os
// arquivos DEPOIS de confirmar que o commit no banco passou).
async function executarCascataExclusaoConta(usuario, t) {
  const usuarioId = usuario.id;

  // ===== 1. Matches e mensagens de chat =====
  const matches = await Match.findAll({
    where: { [Op.or]: [{ usuario1_id: usuarioId }, { usuario2_id: usuarioId }] },
    transaction: t
  });
  const matchIds = matches.map((m) => m.id);
  if (matchIds.length) {
    await Mensagem.destroy({ where: { match_id: { [Op.in]: matchIds } }, transaction: t });
    await Match.destroy({ where: { id: { [Op.in]: matchIds } }, transaction: t });
  }

  // ===== 2. Modo Dupla: duplas, dupla-matches, mensagens e avaliações =====
  const duplas = await Dupla.findAll({
    where: { [Op.or]: [{ usuario1_id: usuarioId }, { usuario2_id: usuarioId }] },
    transaction: t
  });
  const duplaIds = duplas.map((d) => d.id);
  if (duplaIds.length) {
    const duplaMatches = await DuplaMatch.findAll({
      where: { [Op.or]: [{ dupla1_id: { [Op.in]: duplaIds } }, { dupla2_id: { [Op.in]: duplaIds } }] },
      transaction: t
    });
    const duplaMatchIds = duplaMatches.map((dm) => dm.id);
    if (duplaMatchIds.length) {
      await MensagemDupla.destroy({ where: { dupla_match_id: { [Op.in]: duplaMatchIds } }, transaction: t });
      await DuplaMatch.destroy({ where: { id: { [Op.in]: duplaMatchIds } }, transaction: t });
    }
    await DuplaAvaliacao.destroy({
      where: { [Op.or]: [{ dupla_id: { [Op.in]: duplaIds } }, { avaliado_dupla_id: { [Op.in]: duplaIds } }] },
      transaction: t
    });
    await Dupla.destroy({ where: { id: { [Op.in]: duplaIds } }, transaction: t });
  }
  // Avaliações que o usuário deu a duplas que não estão sendo excluídas acima
  await DuplaAvaliacao.destroy({ where: { usuario_id: usuarioId }, transaction: t });

  // ===== 3. Swipes (curtidas/rejeições, como quem deu e como quem recebeu) =====
  await Swipe.destroy({
    where: { [Op.or]: [{ usuario_id: usuarioId }, { alvo_id: usuarioId }] },
    transaction: t
  });

  // ===== 4. Visualizações de perfil (quem viu e quem foi visto) =====
  await VisualizacaoPerfil.destroy({
    where: { [Op.or]: [{ usuario_visto_id: usuarioId }, { usuario_visitante_id: usuarioId }] },
    transaction: t
  });

  // ===== 5. Notificações =====
  await Notificacao.destroy({ where: { usuario_id: usuarioId }, transaction: t });

  // ===== 6. Status / perguntas diárias =====
  await StatusResposta.destroy({ where: { usuario_id: usuarioId }, transaction: t });

  // ===== 7. Fotos da galeria (guarda as URLs para apagar os arquivos físicos depois) =====
  const fotos = await FotoPerfil.findAll({ where: { usuario_id: usuarioId }, transaction: t });
  const arquivosParaApagar = fotos.map((f) => f.url);
  await FotoPerfil.destroy({ where: { usuario_id: usuarioId }, transaction: t });

  // ===== 8. Contatos de confiança =====
  await ContatoConfianca.destroy({ where: { usuario_id: usuarioId }, transaction: t });

  // ===== 9. Confirmações de presença em eventos =====
  await EventoConfirmacao.destroy({ where: { usuario_id: usuarioId }, transaction: t });

  // ===== 10. Avaliações pós-encontro =====
  await AvaliacaoEncontro.destroy({ where: { usuario_id: usuarioId }, transaction: t });

  // ===== 11. Alertas de segurança (botão de pânico / check-in perdido) =====
  await AlertaSeguranca.destroy({ where: { usuario_id: usuarioId }, transaction: t });

  // ===== 12. Sessões de segurança (check-in de encontro) =====
  // As sessões do próprio usuário são apagadas. Quando ele aparece só como
  // "acompanhante" (com_usuario_id) na sessão de outra pessoa, apenas desvincula
  // a referência, para não apagar o registro de segurança de quem ainda tem conta ativa.
  await SessaoSeguranca.destroy({ where: { usuario_id: usuarioId }, transaction: t });
  await SessaoSeguranca.update(
    { com_usuario_id: null },
    { where: { com_usuario_id: usuarioId }, transaction: t }
  );

  // ===== 13. Denúncias (feitas pelo usuário ou recebidas por ele) =====
  await Denuncia.destroy({
    where: { [Op.or]: [{ denunciante_id: usuarioId }, { denunciado_id: usuarioId }] },
    transaction: t
  });

  // ===== 14. Bloqueios (nos dois sentidos) =====
  await Bloqueio.destroy({
    where: { [Op.or]: [{ usuario_id: usuarioId }, { bloqueado_id: usuarioId }] },
    transaction: t
  });

  // ===== 15. Solicitações de parceria (dado de contato comercial, não de namoro:
  // anonimiza o vínculo com o usuário em vez de apagar o registro do estabelecimento) =====
  await SolicitacaoParceria.update(
    { usuario_id: null },
    { where: { usuario_id: usuarioId }, transaction: t }
  );

  // ===== 15.1. Indicação recebida (este usuário foi indicado por um parceiro) =====
  await Indicacao.destroy({ where: { usuario_indicado_id: usuarioId }, transaction: t });

  // ===== 15.2. Se este usuário É parceiro do Programa de Parceiros =====
  // Defesa em profundidade: não depende só da constraint do banco (ver
  // FIX_CASCADE_PARCEIROS.sql) — apaga explicitamente aqui também. Se
  // houver comissão pendente (dinheiro que a empresa ainda deve ao
  // parceiro), bloqueia a exclusão em vez de apagar o registro em silêncio.
  const parceiro = await Parceiro.findOne({ where: { usuario_id: usuarioId }, transaction: t });
  if (parceiro) {
    const comissaoPendente = await Comissao.findOne({
      where: { parceiro_id: parceiro.id, status_pagamento: 'pendente' },
      transaction: t
    });
    if (comissaoPendente) {
      throw new ExclusaoContaBloqueada(
        'Você tem comissões pendentes no Programa de Parceiros. Entre em contato com o suporte antes de excluir sua conta.'
      );
    }
    await BonusMeta.destroy({ where: { parceiro_id: parceiro.id }, transaction: t });
    await Comissao.destroy({ where: { parceiro_id: parceiro.id }, transaction: t });
    await Indicacao.destroy({ where: { parceiro_id: parceiro.id }, transaction: t });
    await parceiro.destroy({ transaction: t });
  }

  // ===== 16. Por fim, o próprio usuário =====
  const fotoUrl = usuario.foto_url;
  const fotoReferenciaLiveness = usuario.foto_referencia_liveness;
  await usuario.destroy({ transaction: t });

  return { fotoUrl, fotoReferenciaLiveness, arquivosParaApagar };
}

// Apaga os arquivos físicos de uma conta já excluída — só deve ser chamado
// DEPOIS do commit da transação confirmado, nunca antes (senão um rollback
// deixaria o registro no banco intacto mas o arquivo já teria sumido).
function apagarArquivosDaContaExcluida({ fotoUrl, fotoReferenciaLiveness, arquivosParaApagar }) {
  arquivosParaApagar.forEach(apagarArquivoUpload);
  apagarArquivoUpload(fotoUrl);
  apagarArquivoLivenessSeExistir(fotoReferenciaLiveness);
}

// DELETE /api/usuario/conta
// Exclui definitivamente a conta do usuário autenticado (LGPD - direito de exclusão),
// junto com todos os dados relacionados encontrados no schema atual.
// Exige a senha atual no corpo da requisição, como confirmação extra para uma ação irreversível.
const excluirConta = async (req, res) => {
  const usuarioId = req.usuarioId;
  const { senha } = req.body;

  if (!senha) {
    return res.status(400).json({ erro: 'Informe sua senha para confirmar a exclusão da conta.' });
  }

  const t = await sequelize.transaction();

  try {
    const usuario = await Usuario.findByPk(usuarioId, { transaction: t });
    if (!usuario) {
      await t.rollback();
      return res.status(404).json({ erro: 'Usuário não encontrado.' });
    }

    const senhaCorreta = await bcrypt.compare(senha, usuario.senha);
    if (!senhaCorreta) {
      await t.rollback();
      return res.status(401).json({ erro: 'Senha incorreta.' });
    }

    const resultado = await executarCascataExclusaoConta(usuario, t);
    await t.commit();
    apagarArquivosDaContaExcluida(resultado);

    return res.json({ mensagem: 'Conta excluída com sucesso.' });
  } catch (erro) {
    await t.rollback();
    if (erro instanceof ExclusaoContaBloqueada) {
      return res.status(409).json({ erro: erro.message });
    }
    console.error('Erro ao excluir conta:', erro);
    return res.status(500).json({ erro: 'Não foi possível excluir a conta. Tente novamente em instantes.' });
  }
};

module.exports = { excluirConta, executarCascataExclusaoConta, apagarArquivosDaContaExcluida, ExclusaoContaBloqueada };
