// livenessController.js
// Lógica de backend para o Face Liveness do Vínculo.
//
// Fluxo completo (atualizado):
// 1. Liveness confirma que existe uma pessoa de verdade, viva, na câmera (Rekognition Face
//    Liveness). Isso roda logo após o cadastro, ANTES de existir qualquer foto de perfil.
//    Se aprovado, a imagem de referência do liveness é salva e guardada em
//    foto_referencia_liveness — ela é a "referência confiável" do rosto do usuário.
// 2. O usuário completa o resto do cadastro (bio, prompts, etc) e, em algum momento,
//    envia sua primeira foto de perfil (perfilController.uploadFoto). É SÓ NESSE MOMENTO
//    que a foto é comparada (Rekognition CompareFaces, via compararRostos) com a
//    referência do liveness, silenciosamente. Se bater, aí sim o usuário vira verificado.
// 3. Fotos extras da galeria (depois da primeira) não passam por nenhuma comparação.

const {
  RekognitionClient,
  CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand,
} = require('@aws-sdk/client-rekognition');
const Usuario = require('../models/Usuario');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REGIAO_LIVENESS = process.env.AWS_REKOGNITION_LIVENESS_REGION || 'us-east-1';

// Timeouts explícitos: sem eles, o SDK espera INDEFINIDAMENTE por uma resposta
// da AWS. Se a Rekognition ficar lenta ou a conexão de saída pendurar, a rota
// nunca responde, o fetch do app fica aberto para sempre e o usuário trava na
// tela "preparando a câmera" sem erro nenhum — que é exatamente o sintoma
// relatado. Com timeout, a chamada falha rápido e vira erro tratável.
const rekognitionClient = new RekognitionClient({
  region: REGIAO_LIVENESS,
  maxAttempts: 3,
  requestHandler: {
    connectionTimeout: 5000,
    requestTimeout: 15000
  }
});
const CONFIANCA_MINIMA = Number(process.env.LIVENESS_CONFIANCA_MINIMA || 90);

async function criarSessaoLiveness(req, res) {
  const inicio = Date.now();
  try {
    const comando = new CreateFaceLivenessSessionCommand({});
    const resultado = await rekognitionClient.send(comando);
    console.log(`[liveness] sessão criada em ${Date.now() - inicio}ms para usuário ${req.usuarioId}`);
    return res.json({ sessionId: resultado.SessionId });
  } catch (erro) {
    // Log detalhado: sem um sistema de log persistente no projeto, o stdout do
    // Railway é a única trilha para diagnosticar travamentos como este.
    console.error('[liveness] FALHA ao criar sessão', {
      usuario: req.usuarioId,
      ms: Date.now() - inicio,
      nome: erro.name,
      mensagem: erro.message,
      regiao: REGIAO_LIVENESS
    });
    return res.status(500).json({ erro: 'Não foi possível iniciar a verificação de liveness.' });
  }
}

// Credita o bônus de indicação pra quem indicou o usuário recém-verificado.
// Reutilizada pelo perfilController.uploadFoto, que agora é o lugar do backend
// que efetivamente confirma identidade (comparando a 1ª foto de perfil com a
// referência do liveness).
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

    if (!livenessPassou || !resultado.ReferenceImage || !resultado.ReferenceImage.Bytes || !req.usuarioId) {
      return res.json({ aprovado: false, confianca, status: resultado.Status });
    }

    // Salva a imagem de referência do liveness — ela ainda não é comparada com nada
    // aqui (não existe foto de perfil nesse ponto do fluxo). Fica guardada pra ser
    // usada como referência quando o usuário definir a primeira foto de perfil
    // (ver perfilController.uploadFoto).
    const pasta = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(pasta)) fs.mkdirSync(pasta, { recursive: true });
    const nomeArquivo = `${crypto.randomUUID()}.jpg`;
    const caminhoReferencia = path.join(pasta, nomeArquivo);
    fs.writeFileSync(caminhoReferencia, Buffer.from(resultado.ReferenceImage.Bytes));

    // Liveness aprovado é suficiente pra essa etapa. "verificado" só vira true
    // mais adiante, quando a primeira foto de perfil bater com essa referência.
    await Usuario.update(
      {
        liveness_aprovado: true,
        liveness_confianca: confianca,
        foto_referencia_liveness: '/uploads/' + nomeArquivo,
      },
      { where: { id: req.usuarioId } }
    );

    return res.json({ aprovado: true, confianca, status: resultado.Status });
  } catch (erro) {
    console.error('Erro ao buscar resultado de liveness:', erro);
    return res.status(500).json({ erro: 'Não foi possível verificar o resultado do liveness.' });
  }
}

module.exports = { criarSessaoLiveness, buscarResultadoLiveness, creditarBonusIndicacaoSeAplicavel };
