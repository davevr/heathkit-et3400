// Seven-segment patterns as the latches hold them: bit 7 = dp, 6 = a ... 0 = g.

const GLYPHS: Record<number, string> = {
  0x00: ' ', 0x08: '_', 0x01: '-',
  0x7e: '0', 0x30: '1', 0x6d: '2', 0x79: '3', 0x33: '4', 0x5b: '5', 0x5f: '6', 0x70: '7',
  0x7f: '8', 0x7b: '9', 0x77: 'A', 0x1f: 'b', 0x4e: 'C', 0x3d: 'd', 0x4f: 'E', 0x47: 'F',
  0x0d: 'c', 0x67: 'P', 0x3e: 'U', 0x15: 'n', 0x05: 'r', 0x1d: 'o', 0x37: 'H', 0x0e: 'L',
}

/** Read the display back as text ("5" and "S" share a pattern, as do "1" and "I"). */
export function displayText(segments: Uint8Array, labels = true): string {
  let text = ''
  segments.forEach((pattern, i) => {
    let ch = GLYPHS[pattern & 0x7f] ?? '?'
    // In a two-letter register label the shared patterns are letters.
    if (labels && i < 2) {
      const pair = `${GLYPHS[segments[0] & 0x7f]}${GLYPHS[segments[1] & 0x7f]}`
      if (pair === '5P') ch = i === 0 ? 'S' : 'P'
      if (pair === '1n') ch = i === 0 ? 'I' : 'n'
    }
    text += ch + (pattern & 0x80 ? '.' : '')
  })
  return text
}
