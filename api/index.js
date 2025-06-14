import express from 'express'
import mysql from 'mysql2/promise'
import neo4j from 'neo4j-driver'
import dotenv from 'dotenv'
import cors from 'cors'

dotenv.config()
const app = express()
const port = 3000

app.use(cors({ origin: 'http://localhost:8080' }))
app.use(express.json())

// Aguarda o MySQL estar pronto antes de criar as tabelas
async function waitForMysqlReady(retries = 15, delay = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      const conn = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
      });
      await conn.ping();
      await conn.end();
      return true;
    } catch (err) {
      if (i === retries - 1) throw err;
      console.log(`Aguardando MySQL... (${i + 1}/${retries})`);
      await new Promise(res => setTimeout(res, delay));
    }
  }
}

// Cria as tabelas e FK
async function ensureTables() {
  await waitForMysqlReady();
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });
  // Tabela de chácaras
  await conn.query(`
    CREATE TABLE IF NOT EXISTS chacaras (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(255) NOT NULL
    )
  `);
  // Tabela de reservas com FK para chacaras
  await conn.query(`
    CREATE TABLE IF NOT EXISTS reservas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      chacara_id INT NOT NULL,
      nome VARCHAR(255),
      email VARCHAR(255),
      telefone VARCHAR(50),
      pessoas VARCHAR(50),
      checkin DATE,
      checkout DATE,
      mensagem TEXT,
      piscina BOOLEAN,
      churrasqueira BOOLEAN,
      campo BOOLEAN,
      eventos BOOLEAN,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      synced BOOLEAN DEFAULT FALSE,
      FOREIGN KEY (chacara_id) REFERENCES chacaras(id) ON DELETE CASCADE
    )
  `);
  // Insere chácaras padrão se não existirem
  const [rows] = await conn.query('SELECT COUNT(*) as total FROM chacaras');
  if (rows[0].total === 0) {
    await conn.query('INSERT INTO chacaras (nome) VALUES (?), (?), (?)', [
      'Estância Paulista', 'Recanto Verde', 'Paraíso das Águas'
    ]);
  }
  await conn.end();
}
ensureTables();

// Endpoint para status do MySQL
app.get('/mysql', async (req, res) => {
  try {
    const conn = await mysql.createConnection({
      host: process.env.MYSQL_HOST,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
    })
    const [rows] = await conn.query('SELECT NOW() AS hora')
    res.json({ status: 'ok', data: rows[0] })
  } catch (err) {
    console.error('Erro MySQL:', err) // <-- Adicionado para logar o erro no terminal
    res.status(500).json({ status: 'error', error: err.message }) // já retorna o erro para o frontend
  }
})

// Endpoint para status do Neo4j
app.get('/neo4j', async (req, res) => {
  try {
    const driver = neo4j.driver(
      process.env.NEO4J_URI,
      neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
    )
    const session = driver.session()
    const result = await session.run('RETURN "ok" AS status')
    const status = result.records[0].get('status')
    await session.close()
    await driver.close()
    res.json({ status: status })
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message })
  }
})

// Lista todas as chácaras do banco
app.get('/chacaras', async (req, res) => {
  try {
    const conn = await mysql.createConnection({
      host: process.env.MYSQL_HOST,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
    });
    const [rows] = await conn.query('SELECT id, nome FROM chacaras');
    await conn.end();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Salva reserva no MySQL
app.post('/reservas', async (req, res) => {
  try {
    const {
      nome, email, telefone, pessoas, checkin, checkout, mensagem, comodidades, chacara_id
    } = req.body

    const conn = await mysql.createConnection({
      host: process.env.MYSQL_HOST,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
    })

    const [result] = await conn.execute(
      `INSERT INTO reservas
        (chacara_id, nome, email, telefone, pessoas, checkin, checkout, mensagem, piscina, churrasqueira, campo, eventos)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        chacara_id, nome, email, telefone, pessoas, checkin, checkout, mensagem,
        comodidades?.piscina || false,
        comodidades?.churrasqueira || false,
        comodidades?.campo || false,
        comodidades?.eventos || false
      ]
    )
    await conn.end()
    res.json({ reservationId: result.insertId })
  } catch (err) {
    console.error('Erro ao salvar reserva no MySQL:', err)
    res.status(500).json({ error: err.message })
  }
})

// Sincroniza todas as chácaras do MySQL para o Neo4j
async function syncChacarasToNeo4j(session) {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });
  const [chacaras] = await conn.query('SELECT id, nome FROM chacaras');
  await conn.end();

  // Remove chácaras do Neo4j que não existem mais no MySQL
  await session.run(
    `
    MATCH (c:Chacara)
    WHERE NOT c.id IN $ids
    DETACH DELETE c
    `,
    { ids: chacaras.map(c => c.id) }
  );

  // Garante que todas as chácaras do MySQL existem no Neo4j
  for (const chacara of chacaras) {
    await session.run(
      `
      MERGE (c:Chacara {id: $id})
      SET c.nome = $nome
      `,
      {
        id: chacara.id,
        nome: chacara.nome
      }
    );
  }
}

// Sincroniza reservas do MySQL para o Neo4j, mostrando nome do locatário como "caption"
async function syncReservasToNeo4j(session) {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });

  // Busca todas as reservas e suas chácaras
  const [reservas] = await conn.query(`
    SELECT r.*, c.nome as chacara_nome, c.id as chacara_id FROM reservas r
    JOIN chacaras c ON r.chacara_id = c.id
  `);

  // Remove reservas do Neo4j que não existem mais no MySQL
  const [ids] = await conn.query('SELECT id FROM reservas');
  const reservaIds = ids.map(r => r.id);
  await session.run(
    `
    MATCH (r:Reserva)
    WHERE NOT r.id IN $ids
    DETACH DELETE r
    `,
    { ids: reservaIds }
  );

  // Garante que todas as reservas do MySQL existem no Neo4j e estão ligadas à chácara correta
  for (const reserva of reservas) {
    const checkin = reserva.checkin instanceof Date ? reserva.checkin.toISOString().split('T')[0] : (reserva.checkin || null);
    const checkout = reserva.checkout instanceof Date ? reserva.checkout.toISOString().split('T')[0] : (reserva.checkout || null);
    const createdAt = reserva.createdAt instanceof Date ? reserva.createdAt.toISOString() : (reserva.createdAt || new Date().toISOString());

    await session.run(
      `
      MATCH (c:Chacara {id: $chacara_id})
      MERGE (r:Reserva {id: $id})
      SET
        r.nome = $nome, // nome do locatário para aparecer no gráfico
        r.email = $email,
        r.telefone = $telefone,
        r.pessoas = $pessoas,
        r.checkin = $checkin,
        r.checkout = $checkout,
        r.mensagem = $mensagem,
        r.piscina = $piscina,
        r.churrasqueira = $churrasqueira,
        r.campo = $campo,
        r.eventos = $eventos,
        r.createdAt = datetime($createdAt)
      MERGE (r)-[:PERTENCE_A]->(c)
      `,
      {
        chacara_id: reserva.chacara_id,
        id: reserva.id,
        nome: reserva.nome,
        email: reserva.email,
        telefone: reserva.telefone,
        pessoas: reserva.pessoas,
        checkin,
        checkout,
        mensagem: reserva.mensagem,
        piscina: !!reserva.piscina,
        churrasqueira: !!reserva.churrasqueira,
        campo: !!reserva.campo,
        eventos: !!reserva.eventos,
        createdAt
      }
    );
  }
  await conn.end();
}

// Sincronização geral: mantém Neo4j igual ao MySQL
async function syncToNeo4j() {
  try {
    const driver = neo4j.driver(
      process.env.NEO4J_URI,
      neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
    );
    const session = driver.session();

    await syncChacarasToNeo4j(session);
    await syncReservasToNeo4j(session);

    await session.close();
    await driver.close();
  } catch (err) {
    console.error('Erro ao sincronizar com Neo4j:', err);
  }
}
setInterval(syncToNeo4j, 10000)

app.listen(port, () => {
  console.log(`API rodando em http://localhost:${port}`)
})