// Limitador simples de tentativas por IP, guardado em memória.
// Suficiente pro estágio atual (uma única instância no Railway); se o app
// crescer pra múltiplas instâncias, isso precisa virar Redis ou similar.
const tentativasPorIp = new Map();

function limitarTaxa({ janelaMs = 15 * 60 * 1000, maxTentativas = 8 } = {}) {
  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'desconhecido';
    const agora = Date.now();
    const registro = tentativasPorIp.get(ip) || { contagem: 0, inicio: agora };

    if (agora - registro.inicio > janelaMs) {
      registro.contagem = 0;
      registro.inicio = agora;
    }

    registro.contagem++;
    tentativasPorIp.set(ip, registro);

    if (registro.contagem > maxTentativas) {
      return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' });
    }
    next();
  };
}

// Limpeza periódica pra não vazar memória com IPs antigos
setInterval(() => {
  const agora = Date.now();
  for (const [ip, registro] of tentativasPorIp.entries()) {
    if (agora - registro.inicio > 60 * 60 * 1000) tentativasPorIp.delete(ip);
  }
}, 30 * 60 * 1000);

module.exports = { limitarTaxa };
