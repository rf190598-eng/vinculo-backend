// Limitador simples de tentativas, guardado em memória.
// Suficiente pro estágio atual (uma única instância no Railway); se o app
// crescer pra múltiplas instâncias, isso precisa virar Redis ou similar.
//
// Correção de bug (achado da auditoria de segurança, encontrado ao adicionar
// os limites específicos por rota): antes, TODAS as chamadas de limitarTaxa
// dividiam o mesmo Map indexado só por IP — ou seja, /cadastrar, /login e
// /google/finalizar contavam tentativas juntas no mesmo balde. Agora cada
// chamada recebe uma `chave` (namespace) e o Map é indexado por chave+identificador.
const tentativasPorChave = new Map();

function limitarTaxa({ janelaMs = 15 * 60 * 1000, maxTentativas = 8, chave = 'padrao', porUsuario = false } = {}) {
  return (req, res, next) => {
    // porUsuario: identifica por usuarioId (a rota precisa rodar `autenticar`
    // ANTES deste middleware) em vez de por IP — evita que várias pessoas na
    // mesma rede (wifi de casa, faculdade, escritório) dividam o mesmo limite.
    const identificador = (porUsuario && req.usuarioId)
      ? `usuario:${req.usuarioId}`
      : `ip:${req.ip || req.headers['x-forwarded-for'] || 'desconhecido'}`;
    const chaveCompleta = `${chave}:${identificador}`;

    const agora = Date.now();
    const registro = tentativasPorChave.get(chaveCompleta) || { contagem: 0, inicio: agora };

    if (agora - registro.inicio > janelaMs) {
      registro.contagem = 0;
      registro.inicio = agora;
    }

    registro.contagem++;
    tentativasPorChave.set(chaveCompleta, registro);

    if (registro.contagem > maxTentativas) {
      return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' });
    }
    next();
  };
}

// Limpeza periódica pra não vazar memória com chaves antigas
setInterval(() => {
  const agora = Date.now();
  for (const [chaveCompleta, registro] of tentativasPorChave.entries()) {
    if (agora - registro.inicio > 60 * 60 * 1000) tentativasPorChave.delete(chaveCompleta);
  }
}, 30 * 60 * 1000);

module.exports = { limitarTaxa };
