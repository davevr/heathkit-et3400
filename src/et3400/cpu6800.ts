// Motorola MC6800: every documented opcode, with datasheet cycle counts.

export interface Bus {
  read(addr: number): number
  write(addr: number, value: number): void
}

export const H = 0x20
export const I = 0x10
export const N = 0x08
export const Z = 0x04
export const V = 0x02
export const C = 0x01

// Cycles per opcode, one hex digit each (0 = undocumented), rows 0x-Fx.
// SWI (3F) is 12 and RTI (3B) is 10, so those two are patched below.
const CYCLE_ROWS = [
  '0200002244222222',
  '2200002202020000',
  '4044444444444444',
  '4444444405000090',
  '2002202222202202',
  '2002202222202202',
  '7007707777707747',
  '6006606666606636',
  '2220222022223830',
  '3330333433334045',
  '5550555655556867',
  '4440444544445956',
  '2220222022220030',
  '3330333433330045',
  '5550555655550067',
  '4440444544440056',
]
const CYCLES = new Uint8Array(256)
CYCLE_ROWS.forEach((row, hi) => {
  for (let lo = 0; lo < 16; lo++) CYCLES[hi * 16 + lo] = parseInt(row[lo], 16)
})
CYCLES[0x3b] = 10
CYCLES[0x3f] = 12

export class Cpu6800 {
  a = 0
  b = 0
  x = 0
  pc = 0
  sp = 0
  cc = 0xc0 | I
  /** Stopped in WAI with the registers already stacked. */
  waiting = false
  nmiPending = false
  irqLine = false
  cycles = 0
  private bus: Bus

  constructor(bus: Bus) {
    this.bus = bus
  }

  reset(): void {
    this.cc = 0xc0 | I
    this.waiting = false
    this.nmiPending = false
    this.pc = this.read16(0xfffe)
  }

  nmi(): void {
    this.nmiPending = true
  }

  /** Run one instruction (or take one interrupt); returns cycles used. */
  step(): number {
    let used: number
    if (this.nmiPending) {
      this.nmiPending = false
      used = this.interrupt(0xfffc)
    } else if (this.irqLine && !(this.cc & I)) {
      used = this.interrupt(0xfff8)
    } else if (this.waiting) {
      used = 1
    } else {
      const op = this.fetch()
      this.execute(op)
      used = CYCLES[op] || 2
    }
    this.cycles += used
    return used
  }

  // ---- bus helpers

  private read(addr: number): number {
    return this.bus.read(addr & 0xffff) & 0xff
  }
  private write(addr: number, value: number): void {
    this.bus.write(addr & 0xffff, value & 0xff)
  }
  private read16(addr: number): number {
    return (this.read(addr) << 8) | this.read(addr + 1)
  }
  private write16(addr: number, value: number): void {
    this.write(addr, value >> 8)
    this.write(addr + 1, value)
  }
  private fetch(): number {
    const v = this.read(this.pc)
    this.pc = (this.pc + 1) & 0xffff
    return v
  }
  private fetch16(): number {
    const hi = this.fetch()
    return (hi << 8) | this.fetch()
  }
  private push(value: number): void {
    this.write(this.sp, value)
    this.sp = (this.sp - 1) & 0xffff
  }
  private pull(): number {
    this.sp = (this.sp + 1) & 0xffff
    return this.read(this.sp)
  }
  private push16(value: number): void {
    this.push(value)
    this.push(value >> 8)
  }
  private pull16(): number {
    const hi = this.pull()
    return (hi << 8) | this.pull()
  }

  private interrupt(vector: number): number {
    if (!this.waiting) this.stackRegisters()
    this.waiting = false
    this.cc |= I
    this.pc = this.read16(vector)
    return 12
  }
  private stackRegisters(): void {
    this.push16(this.pc)
    this.push16(this.x)
    this.push(this.a)
    this.push(this.b)
    this.push(this.cc)
  }

  // ---- flags

  private flag(mask: number, on: boolean | number): void {
    if (on) this.cc |= mask
    else this.cc &= ~mask
  }
  private nz(v: number): void {
    this.flag(N, v & 0x80)
    this.flag(Z, (v & 0xff) === 0)
  }
  private nz16(v: number): void {
    this.flag(N, v & 0x8000)
    this.flag(Z, (v & 0xffff) === 0)
    this.flag(V, 0)
  }
  private logic(v: number): number {
    this.nz(v)
    this.flag(V, 0)
    return v & 0xff
  }
  private add(a: number, m: number, carry: number): number {
    const r = a + m + carry
    this.flag(H, (a ^ m ^ r) & 0x10)
    this.flag(V, (a ^ r) & (m ^ r) & 0x80)
    this.flag(C, r > 0xff)
    this.nz(r)
    return r & 0xff
  }
  private sub(a: number, m: number, borrow: number): number {
    const r = a - m - borrow
    this.flag(V, (a ^ m) & (a ^ r) & 0x80)
    this.flag(C, r < 0)
    this.nz(r)
    return r & 0xff
  }
  /** Shifts and rotates set V = N xor C. */
  private shifted(r: number, carryOut: number): number {
    this.flag(C, carryOut)
    this.nz(r)
    this.flag(V, ((this.cc & N) !== 0) !== ((this.cc & C) !== 0))
    return r & 0xff
  }

  /** Column 0-F of the 40-7F block. Returns the new value. */
  private unary(n: number, m: number): number {
    const carry = this.cc & C
    switch (n) {
      case 0x0: {
        const r = -m & 0xff
        this.nz(r)
        this.flag(V, r === 0x80)
        this.flag(C, r !== 0)
        return r
      }
      case 0x3: {
        const r = this.logic(~m)
        this.flag(C, 1)
        return r
      }
      case 0x4:
        return this.shifted(m >> 1, m & 1)
      case 0x6:
        return this.shifted((m >> 1) | (carry << 7), m & 1)
      case 0x7:
        return this.shifted((m >> 1) | (m & 0x80), m & 1)
      case 0x8:
        return this.shifted(m << 1, m & 0x80)
      case 0x9:
        return this.shifted((m << 1) | carry, m & 0x80)
      case 0xa: {
        const r = (m - 1) & 0xff
        this.nz(r)
        this.flag(V, m === 0x80)
        return r
      }
      case 0xc: {
        const r = (m + 1) & 0xff
        this.nz(r)
        this.flag(V, m === 0x7f)
        return r
      }
      case 0xd:
        this.logic(m)
        this.flag(C, 0)
        return m
      case 0xf:
        this.logic(0)
        this.flag(C, 0)
        return 0
      default:
        return m
    }
  }

  /** Column 0-B of the 80-FF block. Returns the new accumulator value. */
  private alu(n: number, acc: number, m: number): number {
    switch (n) {
      case 0x0:
        return this.sub(acc, m, 0)
      case 0x1:
        this.sub(acc, m, 0)
        return acc
      case 0x2:
        return this.sub(acc, m, this.cc & C)
      case 0x4:
        return this.logic(acc & m)
      case 0x5:
        this.logic(acc & m)
        return acc
      case 0x6:
        return this.logic(m)
      case 0x8:
        return this.logic(acc ^ m)
      case 0x9:
        return this.add(acc, m, this.cc & C)
      case 0xa:
        return this.logic(acc | m)
      case 0xb:
        return this.add(acc, m, 0)
      default:
        return acc
    }
  }

  private branchTaken(cond: number): boolean {
    const cc = this.cc
    const n = (cc & N) !== 0
    const z = (cc & Z) !== 0
    const v = (cc & V) !== 0
    const c = (cc & C) !== 0
    switch (cond) {
      case 0x0: return true
      case 0x2: return !(c || z)
      case 0x3: return c || z
      case 0x4: return !c
      case 0x5: return c
      case 0x6: return !z
      case 0x7: return z
      case 0x8: return !v
      case 0x9: return v
      case 0xa: return !n
      case 0xb: return n
      case 0xc: return n === v
      case 0xd: return n !== v
      case 0xe: return !z && n === v
      case 0xf: return z || n !== v
      default: return false
    }
  }

  private branch(taken: boolean): void {
    const offset = this.fetch()
    if (taken) this.pc = (this.pc + (offset < 0x80 ? offset : offset - 0x100)) & 0xffff
  }

  /** Effective address for modes 1 direct, 2 indexed, 3 extended. */
  private address(mode: number): number {
    if (mode === 1) return this.fetch()
    if (mode === 2) return (this.x + this.fetch()) & 0xffff
    return this.fetch16()
  }

  private daa(): void {
    const lo = this.a & 0x0f
    const hi = this.a >> 4
    let adjust = 0
    let carry = this.cc & C
    if (this.cc & H || lo > 9) adjust |= 0x06
    if (carry || hi > 9 || (hi >= 9 && lo > 9)) {
      adjust |= 0x60
      carry = 1
    }
    this.a = (this.a + adjust) & 0xff
    this.nz(this.a)
    this.flag(C, carry)
  }

  private execute(op: number): void {
    const hi = op >> 4
    const n = op & 0x0f

    if (hi === 0x2) {
      this.branch(this.branchTaken(n))
      return
    }

    if (hi >= 0x4 && hi <= 0x7) {
      if (hi === 0x4) this.a = this.unary(n, this.a)
      else if (hi === 0x5) this.b = this.unary(n, this.b)
      else {
        const addr = this.address(hi === 0x6 ? 2 : 3)
        if (n === 0xe) this.pc = addr
        else {
          const m = this.read(addr)
          const r = this.unary(n, m)
          if (n !== 0xd) this.write(addr, r)
        }
      }
      return
    }

    if (hi >= 0x8) {
      const mode = hi & 3
      const isB = op >= 0xc0
      if (n < 0xc) {
        const acc = isB ? this.b : this.a
        if (n === 0x7) {
          if (mode === 0) return
          this.write(this.address(mode), this.logic(acc))
          return
        }
        const m = mode === 0 ? this.fetch() : this.read(this.address(mode))
        const r = this.alu(n, acc, m)
        if (isB) this.b = r
        else this.a = r
        return
      }
      if (n === 0xc) {
        if (isB) return
        const m = mode === 0 ? this.fetch16() : this.read16(this.address(mode))
        // CPX: N and V come from the high-byte subtraction, C is untouched.
        const xh = this.x >> 8
        const mh = m >> 8
        const rh = xh - mh
        this.flag(N, rh & 0x80)
        this.flag(V, (xh ^ mh) & (xh ^ rh) & 0x80)
        this.flag(Z, this.x === m)
        return
      }
      if (n === 0xd) {
        if (isB || mode === 1) return
        if (mode === 0) {
          const offset = this.fetch()
          this.push16(this.pc)
          this.pc = (this.pc + (offset < 0x80 ? offset : offset - 0x100)) & 0xffff
        } else {
          const addr = this.address(mode)
          this.push16(this.pc)
          this.pc = addr
        }
        return
      }
      if (n === 0xe) {
        const m = mode === 0 ? this.fetch16() : this.read16(this.address(mode))
        if (isB) this.x = m
        else this.sp = m
        this.nz16(m)
        return
      }
      // n === 0xf: STS / STX
      if (mode === 0) return
      const value = isB ? this.x : this.sp
      this.write16(this.address(mode), value)
      this.nz16(value)
      return
    }

    switch (op) {
      case 0x01: break // NOP
      case 0x06: this.cc = this.a | 0xc0; break // TAP
      case 0x07: this.a = this.cc; break // TPA
      case 0x08: this.x = (this.x + 1) & 0xffff; this.flag(Z, this.x === 0); break
      case 0x09: this.x = (this.x - 1) & 0xffff; this.flag(Z, this.x === 0); break
      case 0x0a: this.flag(V, 0); break
      case 0x0b: this.flag(V, 1); break
      case 0x0c: this.flag(C, 0); break
      case 0x0d: this.flag(C, 1); break
      case 0x0e: this.flag(I, 0); break
      case 0x0f: this.flag(I, 1); break
      case 0x10: this.a = this.sub(this.a, this.b, 0); break // SBA
      case 0x11: this.sub(this.a, this.b, 0); break // CBA
      case 0x16: this.b = this.logic(this.a); break // TAB
      case 0x17: this.a = this.logic(this.b); break // TBA
      case 0x19: this.daa(); break
      case 0x1b: this.a = this.add(this.a, this.b, 0); break // ABA
      case 0x30: this.x = (this.sp + 1) & 0xffff; break // TSX
      case 0x31: this.sp = (this.sp + 1) & 0xffff; break // INS
      case 0x32: this.a = this.pull(); break
      case 0x33: this.b = this.pull(); break
      case 0x34: this.sp = (this.sp - 1) & 0xffff; break // DES
      case 0x35: this.sp = (this.x - 1) & 0xffff; break // TXS
      case 0x36: this.push(this.a); break
      case 0x37: this.push(this.b); break
      case 0x39: this.pc = this.pull16(); break // RTS
      case 0x3b: // RTI
        this.cc = this.pull() | 0xc0
        this.b = this.pull()
        this.a = this.pull()
        this.x = this.pull16()
        this.pc = this.pull16()
        break
      case 0x3e: // WAI
        this.stackRegisters()
        this.waiting = true
        break
      case 0x3f: // SWI
        this.stackRegisters()
        this.cc |= I
        this.pc = this.read16(0xfffa)
        break
      default:
        break // undocumented: treated as a two-cycle no-op
    }
  }
}
