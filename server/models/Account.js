import mongoose from 'mongoose'

const accountSchema = new mongoose.Schema({
  staffId: { type: String, unique: true, required: true },
  username: { type: String, unique: true, required: true, lowercase: true },
  passwordHash: { type: String, required: true },
}, { timestamps: true, versionKey: false })

export const Account = mongoose.model('Account', accountSchema)
