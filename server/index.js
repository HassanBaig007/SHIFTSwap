import dotenv from 'dotenv'
import { createServer } from 'node:http'
import { connectDatabase, disconnectDatabase } from './db.js'
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
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required')
  if (!process.env.AUTH_DEFAULT_PASSWORD) throw new Error('AUTH_DEFAULT_PASSWORD is required')
  const store = await connectDatabase()
  databaseStatus = 'connected'
  server = createServer(createApp({ allowedOrigins, getDatabaseStatus: () => databaseStatus, store, requireAuthentication: true }))
  server.listen(port, () => console.log(`API running at http://localhost:${port}`))
}

async function shutdown(signal) {
  console.log(`${signal} received, shutting down`)
  server.close(async () => {
    await disconnectDatabase()
    process.exit(0)
  })
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))

start().catch((error) => {
  console.error('API startup failed:', error.message)
  process.exitCode = 1
})
