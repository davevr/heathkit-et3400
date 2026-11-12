// A small two-pass MC6800 assembler: labels, ORG, EQU, FCB, FDB, RMB, END.
// Accumulator forms may be written LDAA or LDA A.

export interface Segment {
  addr: number
  bytes: number[]
}

export interface ListingLine {
  line: number
  addr: number | null
  bytes: number[]
  source: string
}

export interface AsmError {
  line: number
  message: string
}

export interface Assembly {
  segments: Segment[]
  listing: ListingLine[]
  symbols: Map<string, number>
  errors: AsmError[]
}

const INHERENT: Record<string, number> = {
  NOP: 0x01, TAP: 0x06, TPA: 0x07, INX: 0x08, DEX: 0x09, CLV: 0x0a, SEV: 0x0b, CLC: 0x0c,
  SEC: 0x0d, CLI: 0x0e, SEI: 0x0f, SBA: 0x10, CBA: 0x11, TAB: 0x16, TBA: 0x17, DAA: 0x19,
  ABA: 0x1b, TSX: 0x30, INS: 0x31, PULA: 0x32, PULB: 0x33, DES: 0x34, TXS: 0x35, PSHA: 0x36,
  PSHB: 0x37, RTS: 0x39, RTI: 0x3b, WAI: 0x3e, SWI: 0x3f,
}

const BRANCH: Record<string, number> = {
  BRA: 0x20, BHI: 0x22, BLS: 0x23, BCC: 0x24, BHS: 0x24, BCS: 0x25, BLO: 0x25, BNE: 0x26,
  BEQ: 0x27, BVC: 0x28, BVS: 0x29, BPL: 0x2a, BMI: 0x2b, BGE: 0x2c, BLT: 0x2d, BGT: 0x2e,
  BLE: 0x2f, BSR: 0x8d,
}

const UNARY: Record<string, number> = {
  NEG: 0x0, COM: 0x3, LSR: 0x4, ROR: 0x6, ASR: 0x7, ASL: 0x8, LSL: 0x8, ROL: 0x9, DEC: 0xa,
  INC: 0xc, TST: 0xd, CLR: 0xf,
}

const ALU: Record<string, number> = {
  SUB: 0x0, CMP: 0x1, SBC: 0x2, AND: 0x4, BIT: 0x5, LDA: 0x6, STA: 0x7, EOR: 0x8, ADC: 0x9,
  ORA: 0xa, ADD: 0xb,
}

interface MemForm {
  imm?: number
  dir?: number
  idx?: number
  ext?: number
  wide?: boolean
}

const WIDE: Record<string, MemForm> = {
  CPX: { imm: 0x8c, dir: 0x9c, idx: 0xac, ext: 0xbc, wide: true },
  LDS: { imm: 0x8e, dir: 0x9e, idx: 0xae, ext: 0xbe, wide: true },
  STS: { dir: 0x9f, idx: 0xaf, ext: 0xbf },
  LDX: { imm: 0xce, dir: 0xde, idx: 0xee, ext: 0xfe, wide: true },
  STX: { dir: 0xdf, idx: 0xef, ext: 0xff },
  JSR: { idx: 0xad, ext: 0xbd },
  JMP: { idx: 0x6e, ext: 0x7e },
}

type Form =
  | { kind: 'inh'; op: number }
  | { kind: 'rel'; op: number }
  | { kind: 'mem'; form: MemForm }

function lookup(m: string): Form | null {
  if (m in INHERENT) return { kind: 'inh', op: INHERENT[m] }
  if (m in BRANCH) return { kind: 'rel', op: BRANCH[m] }
  if (m in WIDE) return { kind: 'mem', form: WIDE[m] }
  if (m in UNARY) {
    const n = UNARY[m]
    return { kind: 'mem', form: { idx: 0x60 + n, ext: 0x70 + n } }
  }
  if (m.length === 4 && (m[3] === 'A' || m[3] === 'B')) {
    const stem = m.slice(0, 3)
    const isB = m[3] === 'B'
    if (stem in UNARY) return { kind: 'inh', op: (isB ? 0x50 : 0x40) + UNARY[stem] }
    if (stem in ALU) {
      const n = ALU[stem]
      const base = (isB ? 0xc0 : 0x80) + n
      return {
        kind: 'mem',
        form: { imm: n === 7 ? undefined : base, dir: base + 0x10, idx: base + 0x20, ext: base + 0x30 },
      }
    }
  }
  return null
}

class Unresolved extends Error {}

function evaluate(expr: string, symbols: Map<string, number>, pc: number): number {
  const text = expr.trim()
  if (!text) throw new Error('Missing operand')
  const tokens = text.match(/[+-]|[^+-]+/g) ?? []
  let total = 0
  let sign = 1
  let expectTerm = true
  for (const raw of tokens) {
    const tok = raw.trim()
    if (tok === '+' || tok === '-') {
      if (tok === '-') sign = -sign
      expectTerm = true
      continue
    }
    if (!expectTerm) throw new Error(`Cannot read "${text}"`)
    total += sign * term(tok, symbols, pc)
    sign = 1
    expectTerm = false
  }
  if (expectTerm) throw new Error(`Cannot read "${text}"`)
  return total
}

function term(tok: string, symbols: Map<string, number>, pc: number): number {
  if (tok === '*') return pc
  if (/^\$[0-9a-f]+$/i.test(tok)) return parseInt(tok.slice(1), 16)
  if (/^%[01]+$/.test(tok)) return parseInt(tok.slice(1), 2)
  if (/^\d+$/.test(tok)) return parseInt(tok, 10)
  if (/^'.'?$/.test(tok)) return tok.charCodeAt(1)
  if (/^[a-z_.][\w.]*$/i.test(tok)) {
    const v = symbols.get(tok.toUpperCase())
    if (v === undefined) throw new Unresolved(`Unknown label "${tok}"`)
    return v
  }
  throw new Error(`Cannot read "${tok}"`)
}

interface Parsed {
  line: number
  source: string
  label?: string
  mnemonic?: string
  operand: string
}

function parseLine(source: string, line: number): Parsed {
  let text = source.replace(/\t/g, ' ')
  if (/^\s*\*/.test(text)) text = ''
  const semi = text.indexOf(';')
  if (semi >= 0) text = text.slice(0, semi)
  text = text.trimEnd()
  const parsed: Parsed = { line, source, operand: '' }
  if (!text.trim()) return parsed
  let rest = text
  if (!/^\s/.test(text)) {
    const m = /^([a-z_.][\w.]*):?\s*(.*)$/i.exec(text)
    if (!m) throw new Error('Bad label')
    parsed.label = m[1].toUpperCase()
    rest = m[2]
  }
  rest = rest.trim()
  if (!rest) return parsed
  const m = /^(\S+)\s*(.*)$/.exec(rest)!
  let mnemonic = m[1].toUpperCase()
  let operand = m[2].trim()
  // "LDA A #1" and "ASL A" style
  const split = /^([AB])(?:\s+(.*))?$/i.exec(operand)
  if (split && mnemonic.length === 3 && (mnemonic in ALU || mnemonic in UNARY || mnemonic === 'PSH' || mnemonic === 'PUL')) {
    mnemonic += split[1].toUpperCase()
    operand = (split[2] ?? '').trim()
  }
  parsed.mnemonic = mnemonic
  parsed.operand = operand
  return parsed
}

type Mode = 'imm' | 'dir' | 'idx' | 'ext'

export function assemble(source: string): Assembly {
  const symbols = new Map<string, number>()
  const errors: AsmError[] = []
  const listing: ListingLine[] = []
  const lines: Parsed[] = []
  const modes = new Map<number, Mode>()

  source.split(/\r?\n/).forEach((text, i) => {
    try {
      lines.push(parseLine(text, i + 1))
    } catch (e) {
      errors.push({ line: i + 1, message: (e as Error).message })
      lines.push({ line: i + 1, source: text, operand: '' })
    }
  })

  const list = (s: string) => (s.trim() ? s.split(',') : [])

  for (let pass = 1; pass <= 2; pass++) {
    let pc = 0
    let ended = false
    for (const p of lines) {
      if (ended) {
        if (pass === 2) listing.push({ line: p.line, addr: null, bytes: [], source: p.source })
        continue
      }
      const start = pc
      const bytes: number[] = []
      let showAddr = false
      try {
        const m = p.mnemonic
        if (m === 'EQU') {
          if (!p.label) throw new Error('EQU needs a label')
          if (pass === 1) symbols.set(p.label, evaluate(p.operand, symbols, pc) & 0xffff)
        } else {
          if (p.label && pass === 1) {
            if (symbols.has(p.label)) throw new Error(`Label "${p.label}" defined twice`)
            symbols.set(p.label, pc)
          }
          const value = (expr: string) => {
            try {
              return evaluate(expr, symbols, start)
            } catch (e) {
              if (pass === 1 && e instanceof Unresolved) return 0
              throw e
            }
          }
          if (!m) {
            showAddr = !!p.label
          } else if (m === 'ORG') {
            pc = evaluate(p.operand, symbols, pc) & 0xffff
          } else if (m === 'END') {
            ended = true
          } else if (m === 'RMB') {
            showAddr = true
            pc += evaluate(p.operand, symbols, pc)
          } else if (m === 'FCB') {
            for (const item of list(p.operand)) bytes.push(value(item) & 0xff)
          } else if (m === 'FDB') {
            for (const item of list(p.operand)) {
              const v = value(item)
              bytes.push((v >> 8) & 0xff, v & 0xff)
            }
          } else {
            const form = lookup(m)
            if (!form) throw new Error(`Unknown instruction "${m}"`)
            if (form.kind === 'inh') {
              if (p.operand) throw new Error(`${m} takes no operand`)
              bytes.push(form.op)
            } else if (form.kind === 'rel') {
              const target = value(p.operand)
              const offset = target - (start + 2)
              if (pass === 2 && (offset < -128 || offset > 127)) throw new Error('Branch out of range')
              bytes.push(form.op, offset & 0xff)
            } else {
              const f = form.form
              let op = p.operand
              let mode: Mode
              let expr: string
              const indexed = /^(.*),\s*X$/i.exec(op)
              if (op.startsWith('#')) {
                mode = 'imm'
                expr = op.slice(1)
              } else if (indexed) {
                mode = 'idx'
                expr = indexed[1].trim() || '0'
              } else {
                const force = op[0] === '<' ? 'dir' : op[0] === '>' ? 'ext' : null
                if (force) op = op.slice(1)
                expr = op
                if (pass === 2) mode = modes.get(p.line) ?? 'ext'
                else {
                  mode = 'ext'
                  if (force) mode = force
                  else if (f.dir !== undefined) {
                    try {
                      if ((evaluate(expr, symbols, start) & 0xffff) < 0x100) mode = 'dir'
                    } catch (e) {
                      if (!(e instanceof Unresolved)) throw e
                    }
                  }
                  modes.set(p.line, mode)
                }
              }
              const opcode = f[mode]
              if (opcode === undefined) throw new Error(`${m} cannot use that addressing mode`)
              const v = value(expr)
              if (mode === 'ext' || (mode === 'imm' && f.wide)) bytes.push(opcode, (v >> 8) & 0xff, v & 0xff)
              else {
                if (pass === 2 && (v < -128 || v > 255)) throw new Error('Value does not fit in one byte')
                bytes.push(opcode, v & 0xff)
              }
            }
          }
        }
      } catch (e) {
        if (pass === 2 || !(e instanceof Unresolved)) {
          if (!errors.some((x) => x.line === p.line)) errors.push({ line: p.line, message: (e as Error).message })
        }
      }
      pc += bytes.length
      if (pass === 2) {
        listing.push({ line: p.line, addr: bytes.length || showAddr ? start : null, bytes, source: p.source })
      }
    }
  }

  const segments: Segment[] = []
  for (const l of listing) {
    if (!l.bytes.length || l.addr === null) continue
    const last = segments[segments.length - 1]
    if (last && last.addr + last.bytes.length === l.addr) last.bytes.push(...l.bytes)
    else segments.push({ addr: l.addr, bytes: [...l.bytes] })
  }
  errors.sort((a, b) => a.line - b.line)
  return { segments, listing, symbols, errors }
}
