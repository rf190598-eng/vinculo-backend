-- MIGRACAO_PERFIL_EXPANDIDO.sql
--
-- Adiciona as colunas novas do perfil expandido (Formação e trabalho,
-- Estado civil, confirmação de cidade) usadas por models/Usuario.js e
-- controllers/perfilController.js.
--
-- Por quê isso é necessário: em produção, index.js roda
-- sequelize.sync() SEM alter:true (de propósito, por segurança — ver
-- comentário em index.js) — então ele cria tabelas que não existem, mas
-- NÃO adiciona colunas novas a tabelas já existentes. Sem rodar este
-- script, a tabela "usuarios" em produção não teria essas colunas, e
-- qualquer leitura/gravação delas pelo Sequelize falharia.
--
-- Idempotente: usa "ADD COLUMN IF NOT EXISTS", pode rodar mais de uma vez
-- sem erro.
--
-- Rodar UMA VEZ no Query editor do Postgres (Railway), ANTES do deploy do
-- código que usa essas colunas.

BEGIN;

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS escolaridade VARCHAR(255),
  ADD COLUMN IF NOT EXISTS onde_estudou VARCHAR(255),
  ADD COLUMN IF NOT EXISTS profissao VARCHAR(255),
  ADD COLUMN IF NOT EXISTS onde_trabalha VARCHAR(255),
  ADD COLUMN IF NOT EXISTS estado_civil VARCHAR(255),
  ADD COLUMN IF NOT EXISTS cidade_confirmada_pelo_usuario BOOLEAN NOT NULL DEFAULT false;

COMMIT;
