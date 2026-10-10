import mongoose from 'mongoose'

const listingSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  shiftId: { type: String, required: true },
  posterId: { type: String, required: true },
  status: { type: String, enum: ['OPEN', 'CLAIMED', 'WITHDRAWN', 'APPROVED'], required: true },
  claimerId: { type: String, default: null },
  createdAt: { type: String, required: true },
}, { versionKey: false })

listingSchema.index({ shiftId: 1, status: 1 })
listingSchema.index(
  { shiftId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['OPEN', 'CLAIMED'] } } },
)
export const Listing = mongoose.model('Listing', listingSchema)
