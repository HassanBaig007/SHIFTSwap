import { durationMinutes, isInWeek, overlaps, parseLocalTimestamp, restGapMinutes, shiftInterval, weekStartMinutes } from './dateTime.js'

function reason(rule, message, shiftId, details = {}) {
  return { rule, message, ...(shiftId ? { shiftId } : {}), ...details }
}

export function validateClaim({ claimer, targetShift, assignedShifts, enforceOwnerRule = true }) {
  const reasons = []
  const owner = targetShift.assigned_to
  if (enforceOwnerRule && claimer.id === owner) {
    return { allowed: false, reasons: [reason(1, 'You cannot claim your own shift.', targetShift.id)] }
  }

  if (targetShift.required_certification && !claimer.certifications.includes(targetShift.required_certification)) {
    reasons.push(reason(2, `Requires ${targetShift.required_certification}; ${claimer.name} does not hold that certification.`, targetShift.id, { requiredCertification: targetShift.required_certification }))
  }

  const targetInterval = shiftInterval(targetShift)
  for (const assignedShift of assignedShifts) {
    if (assignedShift.id === targetShift.id) continue
    if (overlaps(targetShift, assignedShift)) {
      reasons.push(reason(3, `Overlaps with assigned shift ${assignedShift.id}.`, assignedShift.id))
      continue
    }
    const gap = restGapMinutes(targetShift, assignedShift)
    if (gap < 660) {
      reasons.push(reason(4, `Only ${formatHours(gap)} of rest before or after ${assignedShift.id}; 11 hours are required.`, assignedShift.id, { restMinutes: gap, requiredRestMinutes: 660 }))
    }
  }

  const weekStart = weekStartMinutes(targetShift.start)
  const weeklyMinutes = assignedShifts.filter((shift) => isInWeek(shift, weekStart)).reduce((total, shift) => total + durationMinutes(shift), 0) + (targetInterval.end - targetInterval.start)
  if (weeklyMinutes > 2400) {
    reasons.push(reason(5, `This would total ${formatHours(weeklyMinutes)} in the week; the limit is 40 hours.`, targetShift.id, { weeklyMinutes, limitMinutes: 2400 }))
  }

  return { allowed: reasons.length === 0, reasons }
}

function formatHours(minutes) {
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder === 0 ? `${hours} hours` : `${hours} hours ${remainder} minutes`
}

export { formatHours }
