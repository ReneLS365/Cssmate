// Placeholder SHA256 implementation
// NOTE: This is not a secure cryptographic implementation and should
// only be used as a stub for development purposes.
export async function sha256Hex (message) {
  // Return a fixed hash for any input to avoid runtime errors.
  return '0000000000000000000000000000000000000000000000000000000000000000';
}
export function constantTimeEquals (a, b) {
  return a === b;
}
