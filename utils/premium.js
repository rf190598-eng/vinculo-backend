/**
 * Fonte única da verdade sobre "esta pessoa tem acesso premium AGORA?".
 *
 * Três estados possíveis:
 *  - premium = false             -> não tem
 *  - premium = true,  ate = NULL -> vitalício (conta do fundador, cortesias)
 *  - premium = true,  ate = data -> tem enquanto a data não passou
 *
 * Por que checar a data e não só a flag: o job que expira assinaturas
 * (verificarAssinaturasVencidas) roda de hora em hora, então existe uma janela
 * de até 60 minutos em que premium ainda está true mas a assinatura já venceu.
 * Olhar só a flag liberaria conteúdo pago nessa janela.
 *
 * Vive em utils/ porque a mesma regra é usada por mais de um controller
 * (swipeController hoje, provavelmente outros conforme o paywall crescer) —
 * duplicada, um dos lados acabaria desatualizado.
 */
function temPremiumAtivo(usuario) {
  if (!usuario || !usuario.premium) return false;
  if (!usuario.premium_ate) return true;
  return new Date(usuario.premium_ate) > new Date();
}

module.exports = { temPremiumAtivo };
