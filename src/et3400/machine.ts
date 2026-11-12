// The ET-3400 board: RAM, monitor ROM, keypad matrix and the six LED latches.
//
//   0000-00FF  RAM (0100-01FF with the optional second pair of 2112s)
//   C0xx       keypad, read. A0-A2 low select the three key columns.
//   C1xx       display, write. A4-A6 pick the digit (6 = leftmost), A0-A2 the
//              segment (7 = dp, 6 = a ... 0 = g); D0 = 1 lights it.
//   FC00-FFFF  1K monitor ROM
//
// One addition that the real board does not have: writing to C200 arms a
// single-step NMI, used only by the substitute monitor (the Heath ROM steps
// with software breakpoints and never touches it).

import { Cpu6800, type Bus } from './cpu6800.ts'
import type { Segment } from './assembler.ts'

export const ROM_BASE = 0xfc00
export const ROM_SIZE = 0x400
/** The MC6875's RC oscillator ran the 6800 at roughly 500 kHz. */
export const CLOCK_HZ = 500_000
/** CRC-32 of the original monitor (IC12), as catalogued by MAME. */
export const HEATH_ROM_CRC = 0x2eff1f58

export type Key = number | 'reset'

// Bit n of each column reads 0 while that key is down.
const COLUMNS = [
  [0xd, 0xa, 0x7, 0x4, 0x1, 0x0], // A0 low (C006)
  [0xe, 0xb, 0x8, 0x5, 0x2], // A1 low (C005)
  [0xf, 0xc, 0x9, 0x6, 0x3], // A2 low (C003)
]

const MIN_HOLD = CLOCK_HZ * 0.07
// About a key and a half per second: a careful person reading hex off a listing.
const TYPE_HOLD = CLOCK_HZ * 0.25
const TYPE_GAP = CLOCK_HZ * 0.4

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const b of bytes) {
    crc ^= b
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

export class Trainer implements Bus {
  readonly ram = new Uint8Array(0x200)
  ramSize = 0x100
  rom = new Uint8Array(ROM_SIZE).fill(0xff)
  /** One byte per digit, leftmost first; bit 7 = dp, 6 = a ... 0 = g. */
  readonly segments = new Uint8Array(6)
  readonly cpu = new Cpu6800(this)

  private down = new Set<number>()
  private pressedAt = new Map<number, number>()
  private releaseAt = new Map<number, number>()
  private resetHeld = false
  private stepLatch = 0
  private clock = 0

  private queue: Key[] = []
  private typed: Key | null = null
  private typeTimer = 0
  private typeTotal = 0

  loadRom(image: Uint8Array): void {
    if (image.length !== ROM_SIZE) throw new Error(`The monitor ROM must be ${ROM_SIZE} bytes`)
    this.rom = Uint8Array.from(image)
    this.powerOn()
  }

  powerOn(): void {
    this.ram.fill(0)
    this.segments.fill(0)
    this.cancelTyping()
    this.down.clear()
    this.releaseAt.clear()
    this.stepLatch = 0
    this.resetHeld = false
    this.cpu.reset()
  }

  // ---- bus

  read(addr: number): number {
    if (addr < this.ramSize) return this.ram[addr]
    if (addr >= ROM_BASE) return this.rom[addr - ROM_BASE]
    if ((addr & 0xff00) === 0xc000) {
      let data = 0xff
      for (let col = 0; col < 3; col++) {
        if (addr & (1 << col)) continue
        COLUMNS[col].forEach((key, bit) => {
          if (this.down.has(key)) data &= ~(1 << bit)
        })
      }
      return data
    }
    return 0xff
  }

  write(addr: number, value: number): void {
    if (addr < this.ramSize) this.ram[addr] = value
    else if ((addr & 0xff00) === 0xc100) {
      const digit = (addr >> 4) & 7
      if (digit < 1 || digit > 6) return
      const mask = 1 << (addr & 7)
      if (value & 1) this.segments[6 - digit] |= mask
      else this.segments[6 - digit] &= ~mask
    } else if (addr === 0xc200) {
      // counts this write, the RTI that follows, and one user instruction
      this.stepLatch = 3
    }
  }

  // ---- keys

  press(key: Key): void {
    if (key === 'reset') {
      this.resetHeld = true
      return
    }
    this.down.add(key)
    this.pressedAt.set(key, this.clock)
    this.releaseAt.delete(key)
  }

  /** Releases a key, but never sooner than the monitor's debounce can see it. */
  release(key: Key): void {
    if (key === 'reset') {
      if (this.resetHeld) {
        this.resetHeld = false
        this.cpu.reset()
        this.stepLatch = 0
      }
      return
    }
    if (!this.down.has(key)) return
    const due = (this.pressedAt.get(key) ?? 0) + MIN_HOLD
    if (this.clock >= due) this.down.delete(key)
    else this.releaseAt.set(key, due)
  }

  pressed(): Key[] {
    const keys: Key[] = [...this.down]
    if (this.resetHeld) keys.push('reset')
    return keys
  }

  // ---- keying a program in

  /** Queue key presses to be made at a steady, human-ish pace. */
  type(keys: Key[]): void {
    this.cancelTyping()
    this.queue = [...keys]
    this.typeTotal = keys.length
    this.typeTimer = TYPE_GAP
  }

  cancelTyping(): void {
    if (this.typed !== null) this.release(this.typed)
    this.typed = null
    this.queue = []
    this.typeTotal = 0
  }

  get typing(): boolean {
    return this.typed !== null || this.queue.length > 0
  }

  /** Keys still to press, and how many were queued. */
  get typingProgress(): { left: number; total: number } {
    return { left: this.queue.length, total: this.typeTotal }
  }

  private advanceTyping(cycles: number): void {
    this.typeTimer -= cycles
    if (this.typeTimer > 0) return
    if (this.typed !== null) {
      const key = this.typed
      this.typed = null
      if (key === 'reset') this.release('reset')
      else this.down.delete(key)
      this.typeTimer = TYPE_GAP
    } else {
      const next = this.queue.shift()
      if (next === undefined) return
      this.typed = next
      this.press(next)
      this.typeTimer = TYPE_HOLD
    }
  }

  // ---- running

  run(cycles: number): void {
    let left = cycles
    while (left > 0) {
      // RESET held: the processor is stopped, but time still passes.
      const used = this.resetHeld ? 64 : this.cpu.step()
      left -= used
      this.clock += used
      if (this.stepLatch > 0 && !this.resetHeld && --this.stepLatch === 0) this.cpu.nmi()
      if (this.releaseAt.size) {
        for (const [key, due] of this.releaseAt) {
          if (this.clock >= due) {
            this.down.delete(key)
            this.releaseAt.delete(key)
          }
        }
      }
      if (this.typed !== null || this.queue.length) this.advanceTyping(used)
    }
  }

  /** Put bytes straight into RAM. Returns how many fell outside it. */
  poke(segments: Segment[]): number {
    let missed = 0
    for (const seg of segments) {
      seg.bytes.forEach((b, i) => {
        const addr = seg.addr + i
        if (addr < this.ramSize) this.ram[addr] = b
        else missed++
      })
    }
    return missed
  }
}

/** The key presses that enter a program by hand: RESET, AUTO, address, bytes. */
export function keystrokes(segments: Segment[]): Key[] {
  const keys: Key[] = []
  const hex = (value: number, digits: number) => {
    for (let i = digits - 1; i >= 0; i--) keys.push((value >> (i * 4)) & 0xf)
  }
  for (const seg of segments) {
    keys.push('reset', 0xa)
    hex(seg.addr, 4)
    for (const b of seg.bytes) hex(b, 2)
  }
  keys.push('reset')
  return keys
}
