import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import request from 'supertest'
import seed from '../seed.json' with { type: 'json' }
import { createApp } from '../app.js'
import { StateStore } from '../store.js'
import { durationMinutes, overlaps, restGapMinutes } from '../dateTime.js'
import { validateClaim } from '../rules.js'

function person(id, role = 'STAFF', certifications = []) { return { id, name: id, role, certifications } }
function shift(id, start, end, assigned_to, required_certification = null) { return { id, start, end, assigned_to, required_certification } }
function tempStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shiftswap-test-'))
  const filePath = path.join(directory, 'state.json')
  return { store: new StateStore(filePath), filePath, directory }
}
function setFixture(store, staff, shifts) {
  store.state = { staff, shifts, listings: [], history: [] }
  store.save()
}
function fixtureApp() {
  const fixture = tempStore()
  return { ...fixture, app: createApp({ store: fixture.store, allowedOrigins: ['http://localhost:5173'] }) }
}
async function post(app, pathName, body) { return request(app).post(pathName).send(body) }

function oracleParse(value) {
  const [date, time] = value.split('T')
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  return Date.UTC(year, month - 1, day, hour, minute) / 60000
}
function oracleWeekStart(value) {
  const date = new Date(oracleParse(value) * 60000)
  const days = (date.getUTCDay() + 6) % 7
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - days) / 60000
}
function oracleClaim(claimer, target, assignments) {
  if (claimer.id === target.assigned_to) return [1]
  const rules = []
  if (target.required_certification && !claimer.certifications.includes(target.required_certification)) rules.push(2)
  const targetStart = oracleParse(target.start)
  const targetEnd = oracleParse(target.end)
  let weeklyMinutes = targetEnd - targetStart
  const weekStart = oracleWeekStart(target.start)
  for (const assigned of assignments) {
    const start = oracleParse(assigned.start)
    const end = oracleParse(assigned.end)
    if (start < targetEnd && targetStart < end) rules.push(3)
    else {
      const gap = end <= targetStart ? targetStart - end : start - targetEnd
      if (gap < 660) rules.push(4)
    }
    if (start >= weekStart && start < weekStart + 7 * 24 * 60) weeklyMinutes += end - start
  }
  if (weeklyMinutes > 2400) rules.push(5)
  return rules
}

test('seed integrity and first-run persistence match the supplied seed', () => {
  const { store, filePath } = tempStore()
  const snapshot = store.snapshot()
  assert.deepEqual(snapshot.staff, seed.staff)
  assert.deepEqual(snapshot.shifts, seed.shifts)
  assert.equal(snapshot.staff.length, 10)
  assert.equal(snapshot.staff.filter((person) => person.role === 'STAFF').length, 8)
  assert.equal(snapshot.staff.filter((person) => person.role === 'MANAGER').length, 2)
  assert.equal(snapshot.shifts.length, 61)
  assert.deepEqual(snapshot.listings, [])
  assert.deepEqual(snapshot.history, [])
  assert.equal(fs.existsSync(filePath), true)
  const persisted = new StateStore(filePath)
  assert.deepEqual(persisted.snapshot(), snapshot)
})

test('date arithmetic matches independent oracle at overlap, rest, overnight, and week boundaries', () => {
  const adjacentA = shift('A', '2026-03-02T07:00', '2026-03-02T15:00', 'C')
  const adjacentB = shift('B', '2026-03-02T15:00', '2026-03-03T07:00', 'C')
  assert.equal(overlaps(adjacentA, adjacentB), false)
  assert.equal(restGapMinutes(adjacentA, adjacentB), 0)
  assert.equal(durationMinutes(adjacentB), 960)
  assert.equal(restGapMinutes(adjacentA, shift('C', '2026-03-03T02:00', '2026-03-03T10:00', 'C')), 660)
  assert.equal(restGapMinutes(adjacentA, shift('D', '2026-03-03T02:01', '2026-03-03T10:00', 'C')), 661)
  assert.equal(oracleWeekStart('2026-03-09T00:00'), oracleParse('2026-03-09T00:00'))
  assert.equal(oracleWeekStart('2026-03-08T23:00'), oracleParse('2026-03-02T00:00'))
})

test('validator aggregates independent failures and agrees with the oracle', () => {
  const claimer = person('C', 'STAFF', [])
  const target = shift('TARGET', '2026-03-02T12:00', '2026-03-02T21:00', 'OWNER', 'ICU')
  const assignments = [
    shift('OVERLAP', '2026-03-02T20:00', '2026-03-03T04:00', 'C'),
    shift('REST', '2026-03-03T07:59', '2026-03-03T16:00', 'C'),
    shift('W1', '2026-03-04T07:00', '2026-03-04T15:00', 'C'),
    shift('W2', '2026-03-05T07:00', '2026-03-05T15:00', 'C'),
    shift('W3', '2026-03-06T07:00', '2026-03-06T15:00', 'C'),
  ]
  const expected = oracleClaim(claimer, target, assignments)
  const actual = validateClaim({ claimer, targetShift: target, assignedShifts: assignments })
  assert.deepEqual(actual.reasons.map((item) => item.rule), expected)
  assert.equal(actual.reasons.find((item) => item.rule === 3).shiftId, 'OVERLAP')
  assert.equal(actual.reasons.find((item) => item.rule === 4).shiftId, 'REST')
  assert.equal(actual.reasons.find((item) => item.rule === 5).weeklyMinutes, 2941)
})

test('owner rule short-circuits all other violations', () => {
  const claimer = person('OWNER', 'STAFF', [])
  const target = shift('TARGET', '2026-03-02T07:00', '2026-03-02T15:00', 'OWNER', 'ICU')
  const actual = validateClaim({ claimer, targetShift: target, assignedShifts: [shift('CONFLICT', '2026-03-02T08:00', '2026-03-02T16:00', 'OWNER')] })
  assert.deepEqual(actual.reasons.map((item) => item.rule), [1])
})

test('API enforces stale listing refusal without rule reasons', async () => {
  const { app, store } = fixtureApp()
  setFixture(store, [person('OWNER'), person('C'), person('M', 'MANAGER')], [shift('TARGET', '2026-03-02T07:00', '2026-03-02T15:00', 'OWNER')])
  const posted = await post(app, '/api/listings', { actorId: 'OWNER', shiftId: 'TARGET' })
  const listingId = posted.body.listings[0].id
  await post(app, `/api/listings/${listingId}/withdraw`, { actorId: 'OWNER' })
  const stale = await post(app, `/api/listings/${listingId}/claim`, { actorId: 'C' })
  assert.equal(stale.status, 409)
  assert.equal(stale.body.error, 'no longer available')
  assert.deepEqual(stale.body.reasons, [])
})

test('API state machine preserves ownership through claim, unclaim, rejection, and approval', async () => {
  const { app, store, filePath } = fixtureApp()
  setFixture(store, [person('OWNER'), person('C'), person('M', 'MANAGER')], [shift('TARGET', '2026-03-02T07:00', '2026-03-02T15:00', 'OWNER')])
  const posted = await post(app, '/api/listings', { actorId: 'OWNER', shiftId: 'TARGET' })
  const listingId = posted.body.listings[0].id
  let response = await post(app, `/api/listings/${listingId}/claim`, { actorId: 'C' })
  assert.equal(response.status, 200)
  assert.equal(response.body.shifts[0].assigned_to, 'OWNER')
  response = await post(app, `/api/listings/${listingId}/unclaim`, { actorId: 'C' })
  assert.equal(response.body.listings[0].status, 'OPEN')
  response = await post(app, `/api/listings/${listingId}/claim`, { actorId: 'C' })
  response = await post(app, `/api/listings/${listingId}/reject`, { actorId: 'M' })
  assert.equal(response.body.listings[0].status, 'OPEN')
  response = await post(app, `/api/listings/${listingId}/claim`, { actorId: 'C' })
  response = await post(app, `/api/listings/${listingId}/approve`, { actorId: 'M' })
  assert.equal(response.status, 200)
  assert.equal(response.body.listings[0].status, 'APPROVED')
  assert.equal(response.body.shifts[0].assigned_to, 'C')
  const restarted = new StateStore(filePath).snapshot()
  assert.equal(restarted.shifts[0].assigned_to, 'C')
  assert.equal(restarted.listings[0].status, 'APPROVED')
  assert.ok(restarted.history.some((item) => item.action === 'APPROVE' && item.outcome === 'SUCCESS'))
})

test('approval revalidation refuses new overlapping assignments without partial transfer', async () => {
  const { app, store } = fixtureApp()
  setFixture(store, [person('OWNER'), person('C'), person('M', 'MANAGER')], [shift('TARGET', '2026-03-02T07:00', '2026-03-02T15:00', 'OWNER')])
  const posted = await post(app, '/api/listings', { actorId: 'OWNER', shiftId: 'TARGET' })
  const listingId = posted.body.listings[0].id
  await post(app, `/api/listings/${listingId}/claim`, { actorId: 'C' })
  store.state.shifts.push(shift('NEW', '2026-03-02T10:00', '2026-03-02T18:00', 'C'))
  store.save()
  const refused = await post(app, `/api/listings/${listingId}/approve`, { actorId: 'M' })
  assert.equal(refused.status, 422)
  assert.deepEqual(refused.body.reasons.map((item) => item.rule), [3])
  const state = store.snapshot()
  assert.equal(state.listings[0].status, 'CLAIMED')
  assert.equal(state.shifts.find((item) => item.id === 'TARGET').assigned_to, 'OWNER')
})

test('role permissions and duplicate active listings are enforced', async () => {
  const { app, store } = fixtureApp()
  setFixture(store, [person('OWNER'), person('C'), person('M', 'MANAGER')], [shift('TARGET', '2026-03-02T07:00', '2026-03-02T15:00', 'OWNER')])
  assert.equal((await post(app, '/api/listings', { actorId: 'M', shiftId: 'TARGET' })).status, 400)
  const first = await post(app, '/api/listings', { actorId: 'OWNER', shiftId: 'TARGET' })
  assert.equal(first.status, 200)
  assert.equal((await post(app, '/api/listings', { actorId: 'OWNER', shiftId: 'TARGET' })).status, 409)
  const listingId = first.body.listings[0].id
  assert.equal((await post(app, `/api/listings/${listingId}/claim`, { actorId: 'M' })).status, 400)
  assert.equal((await post(app, `/api/listings/${listingId}/withdraw`, { actorId: 'C' })).status, 400)
  const refusal = store.snapshot().history.find((item) => item.outcome === 'REFUSED' && item.actorId === 'C')
  assert.equal(refusal.action, 'WITHDRAW')
})

test('serialized mutations allow only one of two concurrent claims', async () => {
  const { app, store } = fixtureApp()
  setFixture(store, [person('OWNER'), person('B'), person('C')], [shift('TARGET', '2026-03-02T07:00', '2026-03-02T15:00', 'OWNER')])
  const posted = await post(app, '/api/listings', { actorId: 'OWNER', shiftId: 'TARGET' })
  const listingId = posted.body.listings[0].id
  const results = await Promise.all([
    post(app, `/api/listings/${listingId}/claim`, { actorId: 'B' }),
    post(app, `/api/listings/${listingId}/claim`, { actorId: 'C' }),
  ])
  assert.equal(results.filter((result) => result.status === 200).length, 1)
  assert.equal(results.filter((result) => result.status === 409).length, 1)
  const final = store.snapshot()
  assert.equal(final.listings.filter((item) => ['OPEN', 'CLAIMED'].includes(item.status)).length, 1)
  assert.equal(final.listings[0].status, 'CLAIMED')
})

test('a durable write failure does not change the in-memory state', async () => {
  const { store } = tempStore()
  const before = store.snapshot()
  const originalSave = store.save.bind(store)
  store.save = () => { throw new Error('simulated disk failure') }
  await assert.rejects(store.mutate((draft) => { draft.history.push({ id: 'phantom' }) }), /simulated disk failure/)
  store.save = originalSave
  assert.deepEqual(store.snapshot(), before)
})

test('deterministic generated fixtures agree with the independent oracle', () => {
  let seedValue = 18731
  const next = () => { seedValue = (seedValue * 48271) % 2147483647; return seedValue / 2147483647 }
  const timestamp = (minutes) => {
    const date = new Date(Date.UTC(2026, 2, 2, 0, 0) + minutes * 60000)
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}T${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
  }
  for (let index = 0; index < 100; index += 1) {
    const targetStart = Math.floor(next() * 14 * 24 * 60)
    const targetDuration = 60 + Math.floor(next() * 600)
    const target = shift(`TARGET-${index}`, timestamp(targetStart), timestamp(targetStart + targetDuration), 'OWNER')
    const assignments = []
    for (let item = 0; item < 5; item += 1) {
      const start = Math.floor(next() * 14 * 24 * 60)
      const duration = 60 + Math.floor(next() * 600)
      assignments.push(shift(`A-${index}-${item}`, timestamp(start), timestamp(start + duration), 'C'))
    }
    const claimer = person('C')
    const expected = oracleClaim(claimer, target, assignments)
    const actual = validateClaim({ claimer, targetShift: target, assignedShifts: assignments })
    assert.deepEqual(actual.reasons.map((item) => item.rule), expected)
  }
})

test('approval revalidation reports certification, rest, and weekly-hour failures together', async () => {
  const { app, store } = fixtureApp()
  setFixture(store, [person('OWNER'), person('C', 'STAFF', ['ICU']), person('M', 'MANAGER')], [shift('TARGET', '2026-03-02T07:00', '2026-03-02T15:00', 'OWNER', 'ICU')])
  const posted = await post(app, '/api/listings', { actorId: 'OWNER', shiftId: 'TARGET' })
  const listingId = posted.body.listings[0].id
  await post(app, `/api/listings/${listingId}/claim`, { actorId: 'C' })
  store.state.staff.find((item) => item.id === 'C').certifications = []
  store.state.shifts.push(shift('REST-CONFLICT', '2026-03-01T12:00', '2026-03-01T20:01', 'C'))
  for (let index = 0; index < 5; index += 1) store.state.shifts.push(shift(`WEEK-${index}`, `2026-03-0${3 + index}T07:00`, `2026-03-0${3 + index}T15:00`, 'C'))
  store.save()
  const refused = await post(app, `/api/listings/${listingId}/approve`, { actorId: 'M' })
  assert.equal(refused.status, 422)
  assert.deepEqual(refused.body.reasons.map((item) => item.rule), [2, 4, 5])
  assert.equal(store.snapshot().listings[0].status, 'CLAIMED')
  assert.equal(store.snapshot().shifts.find((item) => item.id === 'TARGET').assigned_to, 'OWNER')
})
