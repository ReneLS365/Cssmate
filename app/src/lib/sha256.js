const HEX_TABLE = [...Array(256).keys()].map(i => i.toString(16).padStart(2, '0'))

function toUint8Array (input) {
  if (input instanceof Uint8Array) return input
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer)
  if (typeof input === 'string') {
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(input)
    }
    const arr = new Uint8Array(input.length)
    for (let i = 0; i < input.length; i++) {
      arr[i] = input.charCodeAt(i) & 0xff
    }
    return arr
  }
  return toUint8Array(String(input ?? ''))
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
])

function rotr (value, amount) {
  return (value >>> amount) | (value << (32 - amount))
}

function sha256Fallback (input) {
  const message = toUint8Array(input)
  const length = message.length
  const withPadding = new Uint8Array(((length + 9 + 63) & ~63))
  withPadding.set(message)
  withPadding[length] = 0x80

  const bitLen = length * 8
  const view = new DataView(withPadding.buffer)
  view.setUint32(withPadding.length - 4, bitLen >>> 0)
  view.setUint32(withPadding.length - 8, Math.floor(bitLen / 0x100000000))

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ])

  const w = new Uint32Array(64)

  for (let offset = 0; offset < withPadding.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4)
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }

    let a = hash[0]
    let b = hash[1]
    let c = hash[2]
    let d = hash[3]
    let e = hash[4]
    let f = hash[5]
    let g = hash[6]
    let h = hash[7]

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + maj) >>> 0

      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }

    hash[0] = (hash[0] + a) >>> 0
    hash[1] = (hash[1] + b) >>> 0
    hash[2] = (hash[2] + c) >>> 0
    hash[3] = (hash[3] + d) >>> 0
    hash[4] = (hash[4] + e) >>> 0
    hash[5] = (hash[5] + f) >>> 0
    hash[6] = (hash[6] + g) >>> 0
    hash[7] = (hash[7] + h) >>> 0
  }

  const digest = new Uint8Array(32)
  const digestView = new DataView(digest.buffer)
  for (let i = 0; i < hash.length; i++) {
    digestView.setUint32(i * 4, hash[i])
  }
  return digest
}

function toHex (bytes) {
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    out += HEX_TABLE[bytes[i]]
  }
  return out
}

export async function sha256Hex (input) {
  const normalized = typeof input === 'string' ? input : String(input ?? '')

  if (typeof window !== 'undefined' && window.crypto?.subtle && typeof TextEncoder !== 'undefined') {
    const data = new TextEncoder().encode(normalized)
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data)
    return toHex(new Uint8Array(hashBuffer))
  }

  const digest = sha256Fallback(normalized)
  return toHex(digest)
}

export function constantTimeEquals (a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}
