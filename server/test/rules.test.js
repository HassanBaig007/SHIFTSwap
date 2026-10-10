import assert from 'node:assert/strict'
import test from 'node:test'
import { validateClaim } from '../rules.js'

const person = (id, certifications = []) => ({ id, name: id, role: 'STAFF', certifications })
const shift = (id, start, end, assigned_to = 'OWNER', required_certification = null) => ({ id, start, end, assigned_to, required_certification })

test('owner rule is exclusive', () => {
  const result = validateClaim({ claimer: person('OWNER'), targetShift: shift('S1', '2026-03-02T07:00', '2026-03-02T15:00'), assignedShifts: [] })
  assert.deepEqual(result.reasons.map((item) => item.rule), [1])
})

test('aggregates certification, overlap, rest, and weekly violations', () => {
  const assigned = [shift('A', '2026-03-02T07:00', '2026-03-02T15:00', 'C'), shift('B', '2026-03-02T20:00', '2026-03-03T04:00', 'C'), shift('C', '2026-03-03T07:00', '2026-03-03T15:00', 'C'), shift('D', '2026-03-04T07:00', '2026-03-04T15:00', 'C'), shift('E', '2026-03-05T15:00', '2026-03-05T23:00', 'C')]
  const result = validateClaim({ claimer: person('C'), targetShift: shift('TARGET', '2026-03-02T12:00', '2026-03-02T20:00', 'OWNER', 'ICU'), assignedShifts: assigned })
  assert.deepEqual(result.reasons.map((item) => item.rule), [2, 3, 4, 5])
  assert.equal(result.reasons[1].shiftId, 'A')
})

test('touching shifts do not overlap and exact eleven hour rest passes', () => {
  const result = validateClaim({ claimer: person('C'), targetShift: shift('TARGET', '2026-03-03T07:00', '2026-03-03T15:00', 'OWNER'), assignedShifts: [shift('A', '2026-03-02T12:00', '2026-03-02T20:00', 'C')] })
  assert.equal(result.allowed, true)
})

test('cross-midnight duration and week start are handled', () => {
  const result = validateClaim({ claimer: person('C'), targetShift: shift('TARGET', '2026-03-09T00:00', '2026-03-09T08:00', 'OWNER'), assignedShifts: [shift('A', '2026-03-08T00:00', '2026-03-09T00:00', 'C')] })
  assert.equal(result.reasons.some((item) => item.rule === 4), true)
  assert.equal(result.reasons.some((item) => item.rule === 5), false)
})

test('pending claims are absent from assigned shift input', () => {
  const result = validateClaim({ claimer: person('C'), targetShift: shift('TARGET', '2026-03-02T07:00', '2026-03-02T15:00', 'OWNER'), assignedShifts: [] })
  assert.equal(result.allowed, true)
})
