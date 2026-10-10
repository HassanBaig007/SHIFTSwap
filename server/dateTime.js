const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
const MINUTES_PER_DAY = 24 * 60

export function parseLocalTimestamp(value) {
  if (typeof value !== 'string') throw new Error('Timestamp must be a string in YYYY-MM-DDTHH:MM format.')
  const match = TIMESTAMP_PATTERN.exec(value)
  if (!match) throw new Error(`Invalid timestamp: ${value}`)
  const [, yearText, monthText, dayText, hourText, minuteText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const timestamp = Date.UTC(year, month - 1, day, hour, minute)
  const date = new Date(timestamp)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute) {
    throw new Error(`Invalid timestamp: ${value}`)
  }
  return timestamp / 60000
}

export function shiftInterval(shift) {
  const start = parseLocalTimestamp(shift.start)
  const end = parseLocalTimestamp(shift.end)
  if (end <= start) throw new Error(`Shift ${shift.id} must end after it starts.`)
  return { start, end }
}

export function durationMinutes(shift) {
  const { start, end } = shiftInterval(shift)
  return end - start
}

export function overlaps(first, second) {
  const a = shiftInterval(first)
  const b = shiftInterval(second)
  return a.start < b.end && b.start < a.end
}

export function restGapMinutes(first, second) {
  const a = shiftInterval(first)
  const b = shiftInterval(second)
  if (a.end <= b.start) return b.start - a.end
  if (b.end <= a.start) return a.start - b.end
  return null
}

export function weekStartMinutes(timestamp) {
  const date = new Date(parseLocalTimestamp(timestamp) * 60000)
  const day = date.getUTCDay()
  const daysSinceMonday = (day + 6) % 7
  return (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 60000) - daysSinceMonday * MINUTES_PER_DAY
}

export function isInWeek(shift, weekStart) {
  const start = parseLocalTimestamp(shift.start)
  return start >= weekStart && start < weekStart + 7 * MINUTES_PER_DAY
}
