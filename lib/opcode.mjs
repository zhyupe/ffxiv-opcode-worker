export function formatOpcode(num) {
  return num.toString(16).padStart(4, '0')
}

export function parseOpcode(text) {
  return parseInt(text, 16)
}
