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

// Aguarda o MySQL estar pronto antes de criar a tabela
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

// Função para criar tabela reservas se não existir
async function ensureTable() {
  await waitForMysqlReady(); // Aguarda o MySQL estar pronto
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });
  await conn.query(`
    CREATE TABLE IF NOT EXISTS reservas (
      id INT AUTO_INCREMENT PRIMARY KEY,
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
      chacara VARCHAR(100),
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      synced BOOLEAN DEFAULT FALSE
    )
  `);
  await conn.end();
}
ensureTable()

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

// Novo endpoint para listar chácaras (mock)
app.get('/chacaras', (req, res) => {
  res.json([
    { id: 1, nome: 'Estância Paulista' },
    { id: 2, nome: 'Recanto Verde' },
    { id: 3, nome: 'Paraíso das Águas' }
  ])
})

// Salva reserva no MySQL
app.post('/reservas', async (req, res) => {
  try {
    const {
      nome, email, telefone, pessoas, checkin, checkout, mensagem, comodidades, chacara
    } = req.body

    const conn = await mysql.createConnection({
      host: process.env.MYSQL_HOST,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
    })

    const [result] = await conn.execute(
      `INSERT INTO reservas
        (nome, email, telefone, pessoas, checkin, checkout, mensagem, piscina, churrasqueira, campo, eventos, chacara)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nome, email, telefone, pessoas, checkin, checkout, mensagem,
        comodidades?.piscina || false,
        comodidades?.churrasqueira || false,
        comodidades?.campo || false,
        comodidades?.eventos || false,
        chacara
      ]
    )
    await conn.end()
    res.json({ reservationId: result.insertId })
  } catch (err) {
    console.error('Erro ao salvar reserva no MySQL:', err)
    res.status(500).json({ error: err.message })
  }
})

// Sincronização periódica MySQL -> Neo4j
async function syncToNeo4j() {
  try {
    const conn = await mysql.createConnection({
      host: process.env.MYSQL_HOST,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
    })
    const [rows] = await conn.query('SELECT * FROM reservas WHERE synced = FALSE')
    if (rows.length === 0) {
      await conn.end()
      return
    }

    const driver = neo4j.driver(
      process.env.NEO4J_URI,
      neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
    )
    const session = driver.session()

    for (const reserva of rows) {
      await session.run(
        `CREATE (r:Reserva {
          id: $id,
          nome: $nome,
          email: $email,
          telefone: $telefone,
          pessoas: $pessoas,
          checkin: $checkin,
          checkout: $checkout,
          mensagem: $mensagem,
          piscina: $piscina,
          churrasqueira: $churrasqueira,
          campo: $campo,
          eventos: $eventos,
          chacara: $chacara,
          createdAt: datetime($createdAt)
        })`,
        {
          id: reserva.id,
          nome: reserva.nome,
          email: reserva.email,
          telefone: reserva.telefone,
          pessoas: reserva.pessoas,
          checkin: reserva.checkin ? reserva.checkin.toISOString().split('T')[0] : null,
          checkout: reserva.checkout ? reserva.checkout.toISOString().split('T')[0] : null,
          mensagem: reserva.mensagem,
          piscina: !!reserva.piscina,
          churrasqueira: !!reserva.churrasqueira,
          campo: !!reserva.campo,
          eventos: !!reserva.eventos,
          chacara: reserva.chacara,
          createdAt: reserva.createdAt ? reserva.createdAt.toISOString() : new Date().toISOString()
        }
      )
      await conn.query('UPDATE reservas SET synced = TRUE WHERE id = ?', [reserva.id])
    }
    await session.close()
    await driver.close()
    await conn.end()
  } catch (err) {
    console.error('Erro ao sincronizar reservas com Neo4j:', err)
  }
}
// Sincroniza a cada 10 segundos
setInterval(syncToNeo4j, 10000)

app.listen(port, () => {
  console.log(`API rodando em http://localhost:${port}`)
})