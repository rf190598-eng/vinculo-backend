// livenessController.js
// Lógica de backend para o Face Liveness do Vínculo.
// Isso NÃO substitui a comparação de rosto (Rekognition CompareFaces) que você já tem —
// é uma etapa ANTERIOR: confirma que existe uma pessoa de verdade, viva, na câmera,
// antes de rodar a comparação de rosto que você já implementou.

const {
  RekognitionClient,
  CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand,
} = require('@aws-sdk/client-rekognition');

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

async function buscarResultadoLiveness(req, res) {
  const { sessionId } = req.params;

  if (!sessionId) {
    return res.status(400).json({ erro: 'sessionId é obrigatório.' });
  }

  try {
    const comando = new GetFaceLivenessSessionResultsCommand({ SessionId: sessionId });
    const resultado = await rekognitionClient.send(comando);

    const confianca = resultado.Confidence || 0;
    const aprovado = resultado.Status === 'SUCCEEDED' && confianca >= CONFIANCA_MINIMA;

    if (aprovado && req.usuario) {
      await req.usuario.update({ liveness_aprovado: true, liveness_confianca: confianca });
    }

    return res.json({ aprovado, confianca, status: resultado.Status });
  } catch (erro) {
    console.error('Erro ao buscar resultado de liveness:', erro);
    return res.status(500).json({ erro: 'Não foi possível verificar o resultado do liveness.' });
  }
}

module.exports = { criarSessaoLiveness, buscarResultadoLiveness };
