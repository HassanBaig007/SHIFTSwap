import assert from 'node:assert/strict'
import test from 'node:test'
import request from 'supertest'
import { createApp } from '../app.js'

function makeApp(database = 'not configured') {
  return createApp({
    allowedOrigins: ['http://localhost:5173'],
    getDatabaseStatus: () => database,
  })
}

test('health reports the current database status', async () => {
  const response = await request(makeApp()).get('/api/health')

  assert.equal(response.status, 200)
  assert.deepEqual(response.body, { status: 'ok', database: 'not configured' })
})

test('readiness fails while the database is unavailable', async () => {
  const response = await request(makeApp()).get('/api/ready')

  assert.equal(response.status, 503)
  assert.equal(response.body.status, 'not ready')
})

test('writes reject empty values before touching the database', async () => {
  const response = await request(makeApp('connected'))
    .post('/api/checks')
    .send({ value: '   ' })

  assert.equal(response.status, 400)
  assert.equal(response.body.error, 'Please enter a value.')
})