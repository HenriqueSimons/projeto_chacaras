import express from 'express'
import mysql from 'mysql2/promise'
import neo4j from 'neo4j-driver'
import dotenv from 'dotenv'
import cors from 'cors' // <-- adicionado

dotenv.config()
const app = express()
const port = 3000

app.use(cors({ origin: 'http://localhost:8080' })) // <-- adicionado

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

app.listen(port, () => {
  console.log(`API rodando em http://localhost:${port}`)
})