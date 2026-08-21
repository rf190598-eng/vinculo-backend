# Auditoria "Fake vs Real" — Vínculo App

Data: 21/08/2026. Diagnóstico apenas — nenhuma correção foi aplicada neste documento.

Metodologia: cada elemento foi rastreado do clique/toque até o handler JS e, quando aplicável, até o endpoint de backend correspondente (ou até a confirmação de que esse endpoint não existe). Achados já mapeados no `streamline-auditoria.md` anterior (ex.: tela `screen-onboarding` morta, modal `overlay-assinatura-ok` nunca acionado, filtros premium de `peso`/`cor_cabelo` sem tela) não são repetidos aqui como "novos", só referenciados quando relevante.

Para cada achado: veredito direto (**funciona de verdade** ou **não funciona, é só aparência**), evidência em código, e severidade (**cosmético/inofensivo** vs **ativamente enganoso** — promete uma mudança real de comportamento que não acontece).

## As 4 perguntas específicas

### 1. Tela "Por hoje é isso" — botão "Ampliar raio de busca"

**Veredito: funciona de verdade**, com uma ressalva de rótulo.

O botão (`prototipo.html:773`) chama `abrirModalFiltros()`, que abre o modal real de filtros pré-preenchido com `pref_distancia_km` do usuário. Ao confirmar, `aplicarFiltrosReal()` envia `PUT /api/perfil/editar`, o backend grava `pref_distancia_km` de verdade, e `swipeController.js` filtra os candidatos por essa distância no carregamento seguinte.

Ressalva (cosmético): o botão não amplia o raio sozinho, ele abre a tela de ajuste manual — a pessoa ainda precisa arrastar o slider e confirmar. O nome sugere uma ação imediata; na prática é um atalho de navegação. Não é enganoso porque a tela que abre é honesta sobre o que faz.

### 2. Filtros "Todos / Perto de mim / Online agora" no Discover

**Veredito: não funciona, é só aparência.**

**Severidade: ativamente enganoso.**

O código inteiro desses chips é:

```html
<div class="filter-chip active">Todos</div>
<div class="filter-chip" onclick="activateFilter(this)">Perto de mim</div>
<div class="filter-chip" onclick="activateFilter(this)">Online agora</div>
```
```js
function activateFilter(el){
  document.querySelectorAll('.filter-chip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
}
```

Isso é tudo: nenhuma chamada de API, nenhum re-filtro da lista exibida. Além disso, "online agora" não existe em nenhum lugar do backend — não há campo de última atividade/presença em nenhum model ou controller. Clicar em qualquer um dos três chips só troca qual botão fica destacado visualmente; os perfis mostrados embaixo continuam exatamente os mesmos.

### 3. Toggles de notificação (novos matches / mensagens / curtidas / novidades)

**Veredito: não funciona, é só aparência** — persistência local, zero efeito no envio real de notificações.

**Severidade: ativamente enganoso** (com uma nota mitigante).

```js
function alternarPreferencia(el, categoria, chave){
  const prefs = obterPreferencias(categoria);
  const novoValor = !valorPreferencia(categoria, chave);
  prefs[chave] = novoValor;
  localStorage.setItem('vinculo_prefs_'+categoria, JSON.stringify(prefs));
  el.classList.toggle('on', novoValor);
}
```

O valor é lido e gravado só em `localStorage`, nunca enviado ao servidor. As únicas origens reais de notificação no backend (match/curtida em `swipeController.js`, mensagem em `chatController.js`, dupla em `duplaController.js`) criam a notificação incondicionalmente, sem checar preferência nenhuma — o campo nem existe em nenhum model. Desligar qualquer um desses toggles não impede nada.

Nota mitigante: existe um aviso pequeno na tela ("Essas preferências ficam salvas neste aparelho"), tecnicamente verdadeiro — mas os rótulos ao lado dos toggles descrevem um comportamento de supressão de notificação que simplesmente não existe, e a leitura natural de quem desliga o toggle é "não vou mais ser incomodado com isso", o que é falso.

## Varredura geral — outros achados

### Ativamente enganosos

**Toggles "Mostrar apenas verificados" / "Bloquear capturas de tela" / "Ocultar sobrenome" (tela Segurança)** — `prototipo.html:1146-1151`. Handlers são só `onclick="this.classList.toggle('on')"`: não chamam nenhuma função nomeada, não persistem em lugar nenhum, nem sobrevivem a um recarregamento de página. É o botão mais vazio do app. "Bloquear capturas de tela" promete algo tecnicamente impossível de fazer com JS de página — não existe API de navegador pra isso, e não há nenhuma tentativa de implementação. "Mostrar apenas verificados" já existe como filtro real em outro lugar (dentro do modal de filtros) — ter uma segunda cópia decorativa do mesmo nome, na tela de Segurança, ao lado de controles que são reais (botão de pânico, check-in), é especialmente grave porque a pessoa não tem como distinguir visualmente qual switch vale e qual não vale nada.

**Selo Premium "Curtidas ilimitadas"** — vendido como benefício exclusivo do Premium, mas `swipeController.js` não tem nenhum limite diário de curtidas para ninguém: usuários grátis já têm curtidas ilimitadas hoje. É cobrar por algo que todo mundo já tem de graça.

**Selo Premium "Filtros avançados"** — o modal de filtros (idade/distância/tipo de conexão/verificados) já é acessível de graça pra qualquer usuário, sem checagem de Premium nenhuma. Os únicos filtros de fato exclusivos no servidor (altura, peso, cor de cabelo) não têm nenhuma tela pra a pessoa preenchê-los — o que está anunciado como exclusivo já é grátis, e o que é de fato exclusivo é inacessível pra todo mundo, pagante ou não.

**Banner Premium "Ver quem visitou seu perfil e aparecer mais vezes"** — o backend só expõe uma contagem agregada de visualizações (sem identidade de quem visitou), e esse endpoint nem é exclusivo de Premium. Não existe, em nenhuma camada do app, tela, rota ou lógica que mostre "quem" visitou o perfil — nem para quem paga. "Aparecer mais vezes" também é falso: a listagem de perfis não tem nenhum critério de ordenação por status Premium. Possivelmente o achado mais grave da varredura: é uma feature vendida que não foi construída em lugar nenhum.

**Dica "Responder a Pergunta do dia para ganhar destaque"** — não existe nenhuma lógica de servidor ligando resposta à pergunta do dia a qualquer boost de posição no feed. Mesma família do achado B3 do audit anterior: o app promete "aparecer mais" em múltiplos lugares, mas o algoritmo de exibição nunca teve noção de prioridade/ranking implementada.

### Cosmético/inofensivo

**Toggles "Modo incógnito" e "Mostrar minha idade"** — não funcionam, mas o próprio app avisa isso por escrito na mesma tela ("ainda não afetam a visibilidade real do seu perfil — isso é o próximo passo de desenvolvimento"). Vale notar que esse aviso contradiz o texto do toggle logo acima ("Navega no app sem aparecer pra ninguém"), mas por ser uma feature explicitamente rotulada como incompleta, a classificação é mais branda que os itens acima.

**Botão "Ver perfis novamente do início"** — tecnicamente funcional (recarrega o feed), mas o rótulo é impreciso: perfis já avaliados continuam permanentemente excluídos no servidor, então o botão não "reseta" nada — só busca se alguém novo se cadastrou. O toast "Novos perfis carregados!" aparece mesmo quando não há ninguém novo. Baixo risco porque o comportamento de fundo é razoável, só o texto está mal calibrado.

**`toggleRedeSocial()` (conectar Instagram/Facebook)** — código órfão: a função existe completa, com toggle e mensagem de badge ativado, mas nenhum elemento do HTML atual chama essa função nem tem os IDs que ela manipula. É resíduo de uma versão anterior da tela de editar perfil, não um botão que a pessoa encontra e toca — mesmo espírito do achado A4 do audit anterior.

## Itens checados e confirmados como reais (não são achados, só documentando o que foi verificado)

- Bloqueio (`POST /api/bloqueio`) e denúncia (`POST /api/denuncia`) — chamam API real, e o backend de fato impede interação entre pessoas bloqueadas.
- Exclusão de conta (`DELETE /api/usuario/conta`) — chama backend real com confirmação de senha.
- Toggle "Mostrar só verificados" dentro do modal de filtros (visualmente igual aos toggles falsos da tela Segurança, mas este é lido de verdade por `aplicarFiltrosReal()` e aplicado no backend).

## Resumo por severidade

**Ativamente enganoso** (promete uma mudança de comportamento real que não acontece):

1. Chips "Perto de mim" / "Online agora" no Discover
2. Toggles de preferência de notificação
3. Toggles "Mostrar apenas verificados" / "Bloquear capturas de tela" / "Ocultar sobrenome" na tela Segurança
4. Selo Premium "Curtidas ilimitadas"
5. Selo Premium "Filtros avançados"
6. Banner Premium "Ver quem visitou seu perfil e aparecer mais vezes"
7. Dica "Responder a Pergunta do dia para ganhar destaque"

**Cosmético/inofensivo:**

1. "Ampliar raio de busca" — funciona, só não amplia sozinho
2. Toggles "Modo incógnito" / "Mostrar minha idade" — não funcionam, mas o app já avisa
3. "Ver perfis novamente do início" — texto impreciso, ação de fundo é sensata
4. `toggleRedeSocial()` — código morto, inalcançável pela pessoa usuária

## Próximos passos sugeridos

Nenhuma correção foi aplicada. Os 7 itens "ativamente enganosos" são os que merecem prioridade — cada um promete algo ao usuário que literalmente não acontece. Recomendo decidir, item por item, entre três caminhos: implementar a lógica de verdade, remover o elemento da tela, ou trocar o texto para não prometer o que não existe. Posso preparar o diff de qualquer um desses caminhos assim que você decidir a prioridade.
