const { RekognitionClient, CompareFacesCommand } = require('@aws-sdk/client-rekognition');
const fs = require('fs');
const UsoRekognition = require('../models/UsoRekognition');

const client = new RekognitionClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

// Limiar de similaridade pra considerar "é a mesma pessoa".
// 90 é um bom equilíbrio entre segurança e não travar usuário legítimo por causa
// de ângulo/luz ruim. Pode ajustar depois com base em dados reais de uso.
const LIMIAR_SIMILARIDADE = Number(process.env.REKOGNITION_LIMIAR || 90);

// O Free Tier da AWS libera 5.000 comparações/mês. Paramos em 4.500 pra deixar
// uma margem de segurança e nunca gerar cobrança sem querer.
const LIMITE_MENSAL_GRATUITO = Number(process.env.REKOGNITION_LIMITE_MENSAL || 4500);

const mesAtual = () => {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
};

/**
 * Verifica se ainda há cota disponível no mês e, se houver, reserva uma unidade
 * incrementando o contador. Retorna false se o limite já foi atingido.
 */
const reservarCota = async () => {
  const mes = mesAtual();
  const [registro] = await UsoRekognition.findOrCreate({
    where: { mes_referencia: mes },
    defaults: { quantidade: 0 }
  });

  if (registro.quantidade >= LIMITE_MENSAL_GRATUITO) {
    return false;
  }

  await registro.increment('quantidade');
  return true;
};

/**
 * Compara a selfie de verificação com a foto de perfil do usuário.
 * @param {string} caminhoSelfie - caminho local do arquivo da selfie recém-enviada
 * @param {string} caminhoFotoPerfil - caminho local da foto de perfil já cadastrada
 * @returns {Promise<{bateu: boolean, similaridade: number|null, motivo?: string}>}
 */
const compararRostos = async (caminhoSelfie, caminhoFotoPerfil) => {
  // Se as credenciais da AWS não estiverem configuradas, falha de forma explícita
  // em vez de deixar passar silenciosamente como "verificado".
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    throw new Error('Credenciais da AWS não configuradas (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)');
  }

  const dentroDoLimite = await reservarCota();
  if (!dentroDoLimite) {
    throw new Error('Limite mensal de verificações faciais gratuitas atingido. Tente novamente no próximo mês ou aumente o limite.');
  }

  const bytesSelfie = fs.readFileSync(caminhoSelfie);
  const bytesFotoPerfil = fs.readFileSync(caminhoFotoPerfil);

  try {
    const comando = new CompareFacesCommand({
      SourceImage: { Bytes: bytesSelfie },
      TargetImage: { Bytes: bytesFotoPerfil },
      SimilarityThreshold: 1 // pedimos tudo pra API e decidimos o corte aqui, pra logar o valor real
    });

    const resultado = await client.send(comando);

    if (!resultado.FaceMatches || resultado.FaceMatches.length === 0) {
      return { bateu: false, similaridade: 0, motivo: 'Nenhum rosto correspondente encontrado entre as duas fotos' };
    }

    // Pega a melhor correspondência encontrada
    const melhorMatch = resultado.FaceMatches.reduce((maior, atual) =>
      atual.Similarity > maior.Similarity ? atual : maior
    );

    const similaridade = melhorMatch.Similarity;
    const bateu = similaridade >= LIMIAR_SIMILARIDADE;

    return { bateu, similaridade, motivo: bateu ? undefined : 'Similaridade abaixo do limiar exigido' };
  } catch (erro) {
    // InvalidParameterException geralmente significa que não achou rosto em uma das imagens
    if (erro.name === 'InvalidParameterException') {
      return { bateu: false, similaridade: null, motivo: 'Não foi possível identificar um rosto claro em uma das fotos' };
    }
    throw erro;
  }
};

module.exports = { compararRostos, LIMIAR_SIMILARIDADE };
