const StatusResposta = require('../models/StatusResposta');
const Usuario = require('../models/Usuario');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const PERGUNTAS = [
  'Qual foi o lugar mais bonito que você já visitou?',
  'Qual é o seu prato favorito pra cozinhar ou pedir?',
  'Qual série ou filme você já assistiu mais de 3 vezes?',
  'Praia, campo ou cidade grande?',
  'Qual foi a última coisa que te fez rir muito?',
  'Café da manhã, almoço ou jantar — qual refeição você mais ama?',
  'Qual música não pode faltar na sua playlist?',
  'Você prefere planejar
