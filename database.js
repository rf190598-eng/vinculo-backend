const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = process.env.DATABASE_URL
  ? new Sequelize(process.env.DATABASE_URL, {
      dialect: 'postgres',
      logging: false,
      dialectOptions: {
        ssl: {
          require: true,
          rejectUnauthorized: false
        }
      }
    })
  : new Sequelize(
      process.env.DB_NAME,
      process.env.DB_USER,
      process.env.DB_PASS,
      {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        dialect: 'postgres',
        logging: false,
      }
    );

const conectarBanco = async () => {
  try {
    await sequelize.authenticate();
    console.log('Banco de dados conectado com sucesso!');
  } catch (erro) {
    console.error('Erro ao conectar no banco:', erro.message);
  }
};

module.exports = { sequelize, conectarBanco };