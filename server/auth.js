import jwt from 'jsonwebtoken'

export function createToken(actor) {
  return jwt.sign({ staffId: actor.id, role: actor.role }, process.env.JWT_SECRET, { expiresIn: '8h' })
}

export function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET)
}
