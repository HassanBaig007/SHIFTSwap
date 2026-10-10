import dotenv from 'dotenv'
import { createServer } from 'node:http'
import { connectDatabase } from './db.js'
import { createApp } from './app.js'

dotenv.config({ path: new URL('./.env', import.meta.url) })

const port = Number(process.env.PORT || 5000)
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
let databaseStatus = 'not configured'
let server

async function start() {
  const store = await connectDatabase()
  databaseStatus = 'connected'
  server = createServer(createApp({ allowedOrigins, getDatabaseStatus: () => databaseStatus, store }))
  server.listen(port, () => console.log(`API running at http://localhost:${port}`))
}

async function shutdown(signal) {
  console.log(`${signal} received, shutting down`)
  server.close(async () => {
    process.exit(0)
  })
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))

start().catch((error) => {
  console.error('API startup failed:', error.message)
  process.exitCode = 1
})
