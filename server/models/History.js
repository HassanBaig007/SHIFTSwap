import mongoose from 'mongoose'

const historySchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  actorId: String,
  actorName: String,
  actorRole: String,
  action: String,
  shiftId: String,
  listingId: String,
  outcome: String,
  message: String,
  reasons: { type: [mongoose.Schema.Types.Mixed], default: [] },
  previousStatus: String,
  resultingStatus: String,
  timestamp: String,
}, { versionKey: false })

historySchema.index({ timestamp: -1 })
export const History = mongoose.model('History', historySchema)
