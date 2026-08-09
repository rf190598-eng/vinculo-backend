const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const StatusResposta = sequelize.define('StatusResposta', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  usuario_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  tipo: {
    type: DataTypes.STRING,
    allowNull: false
  },
  conteudo_texto: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  media_url: {
    type: DataTypes.STRING,
    allowNull: true
  },
  pergunta_texto: {
    type: DataTypes.STRING,
    allowNull: false
  },
  expira_em: {
    type: DataTypes.DATE,
    allowNull: false
  },
  // Caixas de texto posicionadas sobre um story de vídeo (x/y/rot/escala/cor/texto,
  // em % relativo ao viewport). Só é usado quando tipo === 'video' — o texto não é
  // "queimado" no arquivo, é renderizado como camada por cima na hora de exibir.
  overlays_texto: {
    type: DataTypes.JSON,
    allowNull: true
  },
  // Filtro visual escolhido no editor, como string de CSS filter
  // (ex: "grayscale(1) contrast(1.1)"). Só é preenchido pra tipo 'video':
  // em foto o filtro é queimado nos pixels do arquivo na hora de publicar,
  // então guardar aqui faria o viewer aplicar o efeito duas vezes.
  // O valor é validado contra uma whitelist no controller antes de salvar.
  filtro_css: {
    type: DataTypes.STRING,
    allowNull: true
  },
  // Enquadramento do fundo definido por pinça no editor: { escala, x, y },
  // com x/y em % do quadro (mesma convenção do translate(%) do CSS).
  // Só usado em tipo='video': na foto o zoom já é queimado no canvas ao
  // publicar, então reaplicar aqui ampliaria duas vezes.
  fundo_transform: {
    type: DataTypes.JSON,
    allowNull: true
  },
  // true só quando a pessoa realmente usou a pergunta do dia neste story
  // (tocou no atalho da pergunta no composer e a caixa de texto sobreviveu
  // até o envio). Postar um story qualquer NÃO marca isso — é esse campo,
  // e não a mera existência de um story do dia, que define o "já respondeu"
  // em obterPerguntaDoDia.
  usou_pergunta_dia: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  }
}, {
  tableName: 'status_respostas',
  timestamps: true
});

module.exports = StatusResposta;
