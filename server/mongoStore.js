import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import seed from './seed.json' with { type: 'json' }
import { Staff } from './models/Staff.js'
import { Shift } from './models/Shift.js'
import { Listing } from './models/Listing.js'
import { History } from './models/History.js'
import { Account } from './models/Account.js'
import { parseLocalTimestamp, shiftInterval } from './dateTime.js'

function plain(document) { return document?.toObject ? document.toObject() : document }
function clone(value) { return JSON.parse(JSON.stringify(value)) }

function validateSeed(data) {
  const ids = new Set(data.staff.map((person) => person.id))
  if (data.staff.length !== 10 || data.shifts.length !== 61) throw new Error('Seed must contain the supplied 10 staff and 61 shifts.')
  for (const shift of data.shifts) {
    if (!ids.has(shift.assigned_to)) throw new Error(`Shift ${shift.id} references unknown staff.`)
    shiftInterval(shift)
    parseLocalTimestamp(shift.start)
    parseLocalTimestamp(shift.end)
  }
}

export class MongoStore {
  constructor() { this.queue = Promise.resolve() }

  async initialize() {
    validateSeed(seed)
    if (await Staff.countDocuments() === 0) {
      await Staff.insertMany(seed.staff)
      await Shift.insertMany(seed.shifts)
    }
    const defaultPassword = process.env.AUTH_DEFAULT_PASSWORD
    if (!defaultPassword) throw new Error('AUTH_DEFAULT_PASSWORD is required when initializing accounts.')
    const staff = await Staff.find().lean()
    const accounts = await Account.find().select('staffId').lean()
    const existingIds = new Set(accounts.map((account) => account.staffId))
    const missingAccounts = staff.filter((person) => !existingIds.has(person.id))
    if (missingAccounts.length) await Account.insertMany(await Promise.all(missingAccounts.map(async (person) => ({
      staffId: person.id,
      username: person.id.toLowerCase(),
      passwordHash: await bcrypt.hash(passwordFor(person), 12),
    }))))
    for (const manager of staff.filter((person) => person.role === 'MANAGER')) {
      const configuredPassword = passwordFor(manager)
      if (configuredPassword !== defaultPassword) {
        await Account.updateOne({ staffId: manager.id }, { $set: { passwordHash: await bcrypt.hash(configuredPassword, 12) } })
      }
    }
  }

  async snapshot() {
    const [staff, shifts, listings, history] = await Promise.all([
      Staff.find().lean(), Shift.find().lean(), Listing.find().lean(), History.find().sort({ timestamp: -1 }).lean(),
    ])
    return { staff, shifts, listings, history }
  }

  async findStaff(staffId) { return plain(await Staff.findOne({ id: staffId }).lean()) }

  async authenticate(username, password) {
    const account = await Account.findOne({ username: username.toLowerCase() }).lean()
    if (!account || !(await bcrypt.compare(password, account.passwordHash))) return null
    return this.findStaff(account.staffId)
  }

  async mutate(callback) {
    const operation = this.queue.then(async () => {
      const draft = await this.snapshot()
      const result = await callback(draft)
      const session = await mongoose.startSession()
      try {
        try {
          await session.withTransaction(() => this.persistDraft(draft, { session }))
        } catch (error) {
          const transactionMessage = `${error.message} ${error.originalError?.message || ''}`
          if (!/Transaction numbers are only allowed|replica set|transaction support/i.test(transactionMessage)) throw error
          await this.persistDraft(draft)
        }
      } finally { await session.endSession() }
      return result
    })
    this.queue = operation.catch(() => undefined)
    return operation
  }

  async persistDraft(draft, options = {}) {
    await Staff.bulkWrite(draft.staff.map((item) => ({ updateOne: { filter: { id: item.id }, update: { $set: item }, upsert: true } })), options)
    await Shift.bulkWrite(draft.shifts.map((item) => ({ updateOne: { filter: { id: item.id }, update: { $set: item }, upsert: true } })), options)
    await Listing.deleteMany({}, options)
    if (draft.listings.length) await Listing.insertMany(draft.listings, options)
    await History.deleteMany({}, options)
    if (draft.history.length) await History.insertMany(draft.history, options)
  }
}

function passwordFor(person) {
  if (person.id === 'M1') return process.env.AUTH_M1_PASSWORD || process.env.AUTH_DEFAULT_PASSWORD
  if (person.id === 'M2') return process.env.AUTH_M2_PASSWORD || process.env.AUTH_DEFAULT_PASSWORD
  return process.env.AUTH_DEFAULT_PASSWORD
}
