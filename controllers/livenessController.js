// livenessController.js
// Lógica de backend para o Face Liveness do Vínculo.
//
// Fluxo completo:
// 1. Liveness confirma que existe uma pessoa de verdade, viva, na câmera (Rekognition Face Liveness).
// 2. Só DEPOIS disso, comparamos o rosto capturado no liveness com a foto_url do perfil
//    (Rekognition CompareFaces, via compararRostos) — pra garantir que é a mesma pessoa
//    do perfil, e não só "uma pessoa viva qualquer".
// 3. Só se as duas etapas passarem, o usuário é marcado como verificado.

const {
  RekognitionClient,
  CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand,
} = require('@aws-sdk/client-rekognition');
const Usuario = require('../models/Usuario');
const { compararRostos } = require('../utils/rekognition');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REGIAO_LIVENESS = process.env.AWS_REKOGNITION_LIVENESS_REGION || 'us-east-1';
const rekognitionClient = new RekognitionClient({ region: REGIAO_LIVENESS });
const CONFIANCA_MINIMA = Number(process.env.LIVENESS_CONFIANCA_MINIMA || 90);

async function criarSessaoLiveness(req, res) {
  try {
    const comando = new CreateFaceLivenessSessionCommand({});
    const resultado = await rekognitionClient.send(comando);
    return res.json({ sessionId: resultado.SessionId });
  } catch (erro) {
    console.error('Erro ao criar sessão de liveness:', erro);
    return res.status(500).json({ erro: 'Não foi possível iniciar a verificação de liveness.' });
  }
}

// Credita o bônus de indicação pra quem indicou o usuário recém-verificado.
// Movido de perfilController.uploadSelfieVerificacao (fluxo antigo, removido) pra cá,
// que agora é o único lugar do backend que efetivamente verifica identidade.
async function creditarBonusIndicacaoSeAplicavel(usuarioVerificado) {
  if (!usuarioVerificado.indicado_por || usuarioVerificado.bonus_indicacao_creditado) return;

  const referenciador = await Usuario.findOne({ where: { codigo_indicacao: usuarioVerificado.indicado_por } });
  if (!referenciador) return;

  // Só estende quem já está num plano com data de expiração de verdade (fase paga).
  // Se o indicador já tem premium sem data de expiração (fase gratuita atual),
  // não faz sentido "trocar" isso por um prazo de 7 dias - isso rebaixaria
  // quem deveria estar sendo recompensado.
  if (referenciador.premium_ate) {
    const agora = new Date();
    const baseAtual = new Date(referenciador.premium_ate) > agora ? new Date(referenciador.premium_ate) : agora;
    const novoPremiumAte = new Date(baseAtual.getTime() + 7 * 24 * 60 * 60 * 1000);
    await Usuario.update(
      { premium: true, premium_ate: novoPremiumAte },
      { where: { id: referenciador.id } }
    );
  }

  await Usuario.update(
    { bonus_indicacao_creditado: true },
    { where: { id: usuarioVerificado.id } }
  );
}

async function buscarResultadoLiveness(req, res) {
  const { sessionId } = req.params;

  if (!sessionId) {
    return res.status(400).json({ erro: 'sessionId é obrigatório.' });
  }

  try {
    const comando = new GetFaceLivenessSessionResultsCommand({ SessionId: sessionId });
    const resultado = await rekognitionClient.send(comando);

    const confianca = resultado.Confidence || 0;
    const livenessPassou = resultado.Status === 'SUCCEEDED' && confianca >= CONFIANCA_MINIMA;

    // Liveness sozinho não é suficiente: sem imagem de referência, não dá pra confirmar
    // identidade, então não marcamos como verificado.
    if (!livenessPassou || !resultado.ReferenceImage || !resultado.ReferenceImage.Bytes || !req.usuarioId) {
      return res.json({ aprovado: false, confianca, status: resultado.Status });
    }

    const usuarioAtual = await Usuario.findByPk(req.usuarioId);
    if (!usuarioAtual || !usuarioAtual.foto_url) {
      return res.status(400).json({
        erro: 'Cadastre uma foto de perfil antes de fazer a verificação facial.',
        aprovado: false,
      });
    }

    // Salva a imagem de referência do liveness temporariamente pra poder comparar
    const pasta = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(pasta)) fs.mkdirSync(pasta, { recursive: true });
    const nomeArquivo = `${crypto.randomUUID()}.jpg`;
    const caminhoReferencia = path.join(pasta, nomeArquivo);
    fs.writeFileSync(caminhoReferencia, Buffer.from(resultado.ReferenceImage.Bytes));

    const caminhoFotoPerfil = path.join(__dirname, '..', usuarioAtual.foto_url.replace(/^\//, ''));

    let comparacao;
    try {
      comparacao = await compararRostos(caminhoReferencia, caminhoFotoPerfil);
    } catch (erroComparacao) {
      fs.unlink(caminhoReferencia, () => {});
      return res.status(503).json({
        erro: 'Não foi possível concluir a verificação facial agora. Tente novamente em instantes: ' + erroComparacao.message,
        aprovado: false,
      });
    }

    if (!comparacao.bateu) {
      fs.unlink(caminhoReferencia, () => {});
      return res.status(400).json({
        erro: 'Não foi possível confirmar que é a mesma pessoa da foto de perfil.',
        motivo: comparacao.motivo,
        similaridade: comparacao.similaridade,
        aprovado: false,
      });
    }

    // Liveness passou E é a mesma pessoa da foto de perfil: agora sim, verificado de verdade.
    await Usuario.update(
      {
        liveness_aprovado: true,
        liveness_confianca: confianca,
        foto_verificacao: '/uploads/' + nomeArquivo,
        verificado: true,
      },
      { where: { id: req.usuarioId } }
    );

    const usuarioVerificado = await Usuario.findByPk(req.usuarioId);
    await creditarBonusIndicacaoSeAplicavel(usuarioVerificado);

    return res.json({ aprovado: true, confianca, status: resultado.Status });
  } catch (erro) {
    console.error('Erro ao buscar resultado de liveness:', erro);
    return res.status(500).json({ erro: 'Não foi possível verificar o resultado do liveness.' });
  }
}

module.exports = { criarSessaoLiveness, buscarResultadoLiveness };
