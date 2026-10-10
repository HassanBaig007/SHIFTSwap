import mongoose from 'mongoose'
import { MongoStore } from './mongoStore.js'

export async function connectDatabase() {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is required')
  const connectionUri = /127\.0\.0\.1|localhost/.test(uri) && !uri.includes('retryWrites=')
    ? `${uri}${uri.includes('?') ? '&' : '?'}retryWrites=false`
    : uri
  await mongoose.connect(connectionUri)
  const store = new MongoStore()
  await store.initialize()
  return store
}

export async function disconnectDatabase() {
  await mongoose.disconnect()
}