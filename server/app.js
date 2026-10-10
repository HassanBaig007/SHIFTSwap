import cors from 'cors'
import express from 'express'
import { randomUUID } from 'node:crypto'
import { StateStore } from './store.js'
import { validateClaim } from './rules.js'

const ACTIVE_STATUSES = new Set(['OPEN', 'CLAIMED'])

class ActionFailure {
  constructor(message, reasons = [], status = 400) {
    this.message = message
    this.reasons = reasons
    this.status = status
  }
}

function findActor(state, actorId) { return state.staff.find((person) => person.id === actorId) }
function findListing(state, listingId) { return state.listings.find((listing) => listing.id === listingId) }
function findShift(state, shiftId) { return state.shifts.find((shift) => shift.id === shiftId) }
function activeListing(state, shiftId) { return state.listings.find((listing) => listing.shiftId === shiftId && ACTIVE_STATUSES.has(listing.status)) }

function record(state, { actor, action, shiftId, listingId, outcome, message, reasons = [], previousStatus, resultingStatus }) {
  state.history.unshift({ id: randomUUID(), actorId: actor?.id || 'UNKNOWN', actorName: actor?.name || 'Unknown actor', actorRole: actor?.role || 'UNKNOWN', action, shiftId, listingId, outcome, message, reasons, previousStatus, resultingStatus, timestamp: new Date().toISOString() })
}

function serializeState(state, actorId) {
  const actor = findActor(state, actorId)
  const eligibility = {}
  if (actor?.role === 'STAFF') {
    for (const listing of state.listings.filter((item) => item.status === 'OPEN')) {
      const shift = findShift(state, listing.shiftId)
      eligibility[listing.id] = validateClaim({ claimer: actor, targetShift: shift, assignedShifts: state.shifts.filter((item) => item.assigned_to === actor.id) })
    }
  }
  return { ...state, eligibility }
}

function mutationHandler(store, action, actionName, request, response, next) {
  const actorId = request.body?.actorId
  store.mutate((draft) => {
    const actor = findActor(draft, actorId)
    let result
    try { result = action(draft, actor, request) } catch (error) { if (error instanceof ActionFailure) result = { ok: false, status: error.status, message: error.message, reasons: error.reasons, history: { action: actionName } }; else throw error }
    record(draft, { actor, ...result.history, outcome: result.ok ? 'SUCCESS' : 'REFUSED', message: result.message, reasons: result.reasons })
    return result
  }).then((result) => {
    if (result.ok) return response.status(200).json({ message: result.message, ...serializeState(store.snapshot(), actorId) })
    return response.status(result.status || 400).json({ error: result.message, reasons: result.reasons || [] })
  }).catch(next)
}

function requireActor(actor, role) {
  if (!actor) throw new ActionFailure('Unknown acting person.')
  if (role && actor.role !== role) throw new ActionFailure(`Only ${role.toLowerCase()} actors can perform this action.`)
}

function postListing(state, actor, request) {
  requireActor(actor, 'STAFF')
  const shift = findShift(state, request.body?.shiftId)
  if (!shift) throw new ActionFailure('Shift not found.', [], 404)
  if (shift.assigned_to !== actor.id) throw new ActionFailure('Only the current shift owner can post it.')
  if (activeListing(state, shift.id)) throw new ActionFailure('This shift already has an active listing.', [], 409)
  const listing = { id: randomUUID(), shiftId: shift.id, posterId: actor.id, status: 'OPEN', claimerId: null, createdAt: new Date().toISOString() }
  state.listings.push(listing)
  return { ok: true, message: 'Shift posted for swap.', history: { action: 'POST', shiftId: shift.id, listingId: listing.id, resultingStatus: 'OPEN' } }
}

function withdrawListing(state, actor, request) {
  requireActor(actor, 'STAFF')
  const listing = findListing(state, request.params.id)
  if (!listing) throw new ActionFailure('Listing not found.', [], 404)
  if (listing.posterId !== actor.id) throw new ActionFailure('Only the person who posted this listing can withdraw it.')
  if (listing.status !== 'OPEN') throw new ActionFailure('Only OPEN listings can be withdrawn.')
  listing.status = 'WITHDRAWN'
  return { ok: true, message: 'Listing withdrawn.', history: { action: 'WITHDRAW', shiftId: listing.shiftId, listingId: listing.id, previousStatus: 'OPEN', resultingStatus: 'WITHDRAWN' } }
}

function claimListing(state, actor, request) {
  requireActor(actor, 'STAFF')
  const listing = findListing(state, request.params.id)
  if (!listing) throw new ActionFailure('Listing not found.', [], 404)
  const shift = findShift(state, listing.shiftId)
  if (listing.status !== 'OPEN') return { ok: false, status: 409, message: 'no longer available', history: { action: 'CLAIM', shiftId: shift.id, listingId: listing.id } }
  const validation = validateClaim({ claimer: actor, targetShift: shift, assignedShifts: state.shifts.filter((item) => item.assigned_to === actor.id) })
  if (!validation.allowed) return { ok: false, status: 422, message: 'Claim is not permitted.', reasons: validation.reasons, history: { action: 'CLAIM', shiftId: shift.id, listingId: listing.id } }
  listing.status = 'CLAIMED'
  listing.claimerId = actor.id
  return { ok: true, message: 'Claim submitted for manager approval.', history: { action: 'CLAIM', shiftId: shift.id, listingId: listing.id, previousStatus: 'OPEN', resultingStatus: 'CLAIMED' } }
}

function unclaimListing(state, actor, request) {
  requireActor(actor, 'STAFF')
  const listing = findListing(state, request.params.id)
  if (!listing) throw new ActionFailure('Listing not found.', [], 404)
  if (listing.status !== 'CLAIMED') throw new ActionFailure('Only CLAIMED listings can be unclaimed.')
  if (listing.claimerId !== actor.id) throw new ActionFailure('Only the current claimer can unclaim this listing.')
  listing.status = 'OPEN'; listing.claimerId = null
  return { ok: true, message: 'Claim released; listing is open again.', history: { action: 'UNCLAIM', shiftId: listing.shiftId, listingId: listing.id, previousStatus: 'CLAIMED', resultingStatus: 'OPEN' } }
}

function approveListing(state, actor, request) {
  requireActor(actor, 'MANAGER')
  const listing = findListing(state, request.params.id)
  if (!listing) throw new ActionFailure('Listing not found.', [], 404)
  if (listing.status !== 'CLAIMED') throw new ActionFailure('Only CLAIMED listings can be approved.')
  const shift = findShift(state, listing.shiftId)
  const claimer = findActor(state, listing.claimerId)
  const validation = validateClaim({ claimer, targetShift: shift, assignedShifts: state.shifts.filter((item) => item.assigned_to === claimer.id), enforceOwnerRule: false })
  if (!validation.allowed) return { ok: false, status: 422, message: 'Approval is no longer permitted.', reasons: validation.reasons, history: { action: 'APPROVE', shiftId: shift.id, listingId: listing.id, previousStatus: 'CLAIMED' } }
  shift.assigned_to = claimer.id; listing.status = 'APPROVED'
  return { ok: true, message: 'Claim approved and shift reassigned.', history: { action: 'APPROVE', shiftId: shift.id, listingId: listing.id, previousStatus: 'CLAIMED', resultingStatus: 'APPROVED' } }
}

function rejectListing(state, actor, request) {
  requireActor(actor, 'MANAGER')
  const listing = findListing(state, request.params.id)
  if (!listing) throw new ActionFailure('Listing not found.', [], 404)
  if (listing.status !== 'CLAIMED') throw new ActionFailure('Only CLAIMED listings can be rejected.')
  listing.status = 'OPEN'; listing.claimerId = null
  return { ok: true, message: 'Claim rejected; listing is open again.', history: { action: 'REJECT', shiftId: listing.shiftId, listingId: listing.id, previousStatus: 'CLAIMED', resultingStatus: 'OPEN' } }
}

export function createApp({ getDatabaseStatus = () => 'connected', allowedOrigins = ['http://localhost:5173'], store = new StateStore() } = {}) {
  const app = express()
  app.use(cors({ origin: allowedOrigins }))
  app.use(express.json({ limit: '1mb' }))
  app.get(['/health', '/api/health'], (_request, response) => response.json({ status: 'ok', database: getDatabaseStatus() }))
  app.get(['/ready', '/api/ready'], (_request, response) => { const database = getDatabaseStatus(); return database === 'connected' ? response.json({ status: 'ready', database }) : response.status(503).json({ status: 'not ready', database }) })
  app.get('/api/bootstrap', (request, response) => response.json(serializeState(store.snapshot(), request.query.actorId)))
  app.get('/api/staff', (_request, response) => response.json(store.snapshot().staff))
  app.get('/api/shifts', (_request, response) => response.json(store.snapshot().shifts))
  app.get('/api/listings', (_request, response) => response.json(store.snapshot().listings))
  app.get('/api/history', (_request, response) => response.json(store.snapshot().history))
  app.post('/api/checks', (request, response) => { const value = typeof request.body?.value === 'string' ? request.body.value.trim() : ''; if (!value) return response.status(400).json({ error: 'Please enter a value.' }); return response.status(201).json({ message: 'Stored locally.', entry: { id: randomUUID(), value } }) })
  app.post('/api/listings', (request, response, next) => mutationHandler(store, postListing, 'POST', request, response, next))
  app.post('/api/listings/:id/withdraw', (request, response, next) => mutationHandler(store, withdrawListing, 'WITHDRAW', request, response, next))
  app.post('/api/listings/:id/claim', (request, response, next) => mutationHandler(store, claimListing, 'CLAIM', request, response, next))
  app.post('/api/listings/:id/unclaim', (request, response, next) => mutationHandler(store, unclaimListing, 'UNCLAIM', request, response, next))
  app.post('/api/listings/:id/approve', (request, response, next) => mutationHandler(store, approveListing, 'APPROVE', request, response, next))
  app.post('/api/listings/:id/reject', (request, response, next) => mutationHandler(store, rejectListing, 'REJECT', request, response, next))
  app.use((error, _request, response, _next) => { console.error(error); return response.status(500).json({ error: 'An unexpected server error occurred.' }) })
  return app
}

export { ActionFailure }