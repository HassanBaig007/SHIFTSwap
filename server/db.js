import { StateStore } from './store.js'

export async function connectDatabase(filePath) {
  return new StateStore(filePath)
}

export async function disconnectDatabase() {
  return undefined
}