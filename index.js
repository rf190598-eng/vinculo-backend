const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const { conectarBanco, sequelize } = require('./database');
const Usuario = require('./models/Usuario');
const Swipe = require('./models/Swipe');
const Match = require('./models/Match');
const Mensagem = require('./models/Mensagem');
const ContatoConfianca = require('./models/ContatoConfianca');
const AlertaSeguranca = require('./models/AlertaSeguranca');
const SessaoSeguranca = require('./models/SessaoSeguranca');
const authRoutes = require('./routes/auth');
const swipeRoutes = require('./routes/swipe');
const chatRoutes = require('./routes/chat');
const perfilRoutes = require('./routes/perfil');
const pagamentoRoutes = require('./routes/pagamento');
const segurancaRoutes = require('./routes/seguranca');
const { verificarCheckinsVencidos } = require('./controllers/segurancaController');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/prototipo', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'prototipo.html'));
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => {
  res.json({ status: 'online', app: 'Vinculo Backend', versao: '1.0.0', mensagem: 'Servidor funcionando!' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/swipe', swipeRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/perfil', perfilRoutes);
app.use('/api/pagamento', pagamentoRoutes);
app.use('/api/seguranca', segurancaRoutes);

const iniciar = async () => {
  await conectarBanco();
  await sequelize.sync({ alter: true });
  console.log('Tabelas sincronizadas!');
  app.listen(PORT, () => {
    console.log('Servidor Vinculo rodando na porta ' + PORT);
    console.log('Acesse: http://localhost:' + PORT);
  });
  setInterval(verificarCheckinsVencidos, 60 * 1000);
};

iniciar();
