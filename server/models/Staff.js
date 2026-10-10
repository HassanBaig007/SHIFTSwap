import mongoose from 'mongoose'

const staffSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  name: { type: String, required: true },
  role: { type: String, enum: ['STAFF', 'MANAGER'], required: true },
  certifications: { type: [String], default: [] },
}, { versionKey: false })

export const Staff = mongoose.model('Staff', staffSchema)
