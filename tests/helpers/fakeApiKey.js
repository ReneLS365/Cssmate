export function makeFakeApiKey(totalLength = 39) {
  const prefix = 'A' + 'I' + 'z' + 'a'
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_'
  const restLength = Math.max(totalLength - prefix.length, 0)
  let rest = ''
  for (let i = 0; i < restLength; i += 1) {
    rest += alphabet[(i * 17 + 11) % alphabet.length]
  }
  return prefix + rest
}
