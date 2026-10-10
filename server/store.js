import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import seed from './seed.json' with { type: 'json' }
import { parseLocalTimestamp, shiftInterval } from './dateTime.js'

const serverDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultStatePath = path.join(serverDirectory, 'data', 'state.json')

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function validateSeed(data) {
  if (!Array.isArray(data.staff) || !Array.isArray(data.shifts)) throw new Error('Seed must contain staff and shifts arrays.')
  const staffIds = new Set(data.staff.map((person) => person.id))
  for (const shift of data.shifts) {
    if (!staffIds.has(shift.assigned_to)) throw new Error(`Shift ${shift.id} references unknown staff.`)
    shiftInterval(shift)
    parseLocalTimestamp(shift.start)
    parseLocalTimestamp(shift.end)
  }
}

export class StateStore {
  constructor(filePath = process.env.SHIFTSWAP_DATA_FILE || defaultStatePath) {
    this.filePath = filePath
    this.queue = Promise.resolve()
    if (fs.existsSync(filePath)) {
      this.state = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    } else {
      validateSeed(seed)
      this.state = { staff: clone(seed.staff), shifts: clone(seed.shifts), listings: [], history: [] }
      this.save()
    }
  }

  snapshot() {
    return clone(this.state)
  }

  async mutate(callback) {
    const operation = this.queue.then(async () => {
      const draft = clone(this.state)
      const result = await callback(draft)
      this.save(draft)
      this.state = draft
      return result
    })
    this.queue = operation.catch(() => undefined)
    return operation
  }

  save(nextState = this.state) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.tmp`
    fs.writeFileSync(temporaryPath, JSON.stringify(nextState, null, 2))
    fs.renameSync(temporaryPath, this.filePath)
  }
}

export { defaultStatePath, validateSeed }
