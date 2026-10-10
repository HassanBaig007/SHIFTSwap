import mongoose from 'mongoose'

const checkEntrySchema = new mongoose.Schema(
  {
    value: { type: String, required: true, trim: true, maxlength: 200 },
  },
  { timestamps: true },
)

export const CheckEntry = mongoose.model('CheckEntry', checkEntrySchema)