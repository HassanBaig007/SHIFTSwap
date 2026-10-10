import mongoose from 'mongoose'

const shiftSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  start: { type: String, required: true },
  end: { type: String, required: true },
  required_certification: { type: String, default: null },
  assigned_to: { type: String, required: true },
}, { versionKey: false })

export const Shift = mongoose.model('Shift', shiftSchema)
