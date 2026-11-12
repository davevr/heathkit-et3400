import { describe, expect, it } from 'vitest'
import { assemble } from './assembler.ts'
import { C, Cpu6800, H, N, V, Z } from './cpu6800.ts'
import { crc32, keystrokes, Trainer, type Key } from './machine.ts'
import { buildMonitor } from './monitor.ts'
import { SAMPLES } from './samples.ts'
import { displayText } from './segments.ts'

function runCode(source: string, maxSteps = 10_000) {
  const mem = new Uint8Array(0x10000)
  const asm = assemble(source)
  expect(asm.errors).toEqual([])
  for (const seg of asm.segments) mem.set(seg.bytes, seg.addr)
  const cpu = new Cpu6800({ read: (a) => mem[a], write: (a, v) => (mem[a] = v) })
  cpu.pc = asm.segments[0].addr
  cpu.sp = 0x1ff
  for (let i = 0; i < maxSteps && !cpu.waiting; i++) cpu.step()
  expect(cpu.waiting).toBe(true)
  return { cpu, mem }
}

describe('6800 core', () => {
  it('adds with carry, half carry and overflow', () => {
    const { cpu } = runCode(' ORG $100\n LDAA #$7F\n ADDA #$01\n WAI')
    expect(cpu.a).toBe(0x80)
    expect(cpu.cc & (N | V | H)).toBe(N | V | H)
    expect(cpu.cc & (C | Z)).toBe(0)
  })

  it('subtracts with borrow', () => {
    const { cpu } = runCode(' ORG $100\n LDAB #$10\n SUBB #$20\n WAI')
    expect(cpu.b).toBe(0xf0)
    expect(cpu.cc & (N | C)).toBe(N | C)
  })

  it('does BCD arithmetic with DAA', () => {
    const { cpu } = runCode(' ORG $100\n LDAA #$38\n ADDA #$45\n DAA\n WAI')
    expect(cpu.a).toBe(0x83)
    const carry = runCode(' ORG $100\n LDAA #$99\n ADDA #$01\n DAA\n WAI').cpu
    expect(carry.a).toBe(0x00)
    expect(carry.cc & C).toBe(C)
  })

  it('multiplies by repeated addition using a loop, the stack and a subroutine', () => {
    const { cpu, mem } = runCode(`
        ORG $100
        LDAB #7
        CLRA
LOOP    BSR ADD6
        DECB
        BNE LOOP
        STAA $40
        WAI
ADD6    PSHB
        ADDA #6
        PULB
        RTS`)
    expect(mem[0x40]).toBe(42)
    expect(cpu.sp).toBe(0x1ff - 7) // only the WAI frame is left
  })

  it('handles indexed addressing, CPX and 16-bit stores', () => {
    const { mem } = runCode(`
        ORG $100
        LDX #$0050
FILL    STX 0,X
        INX
        INX
        CPX #$0058
        BNE FILL
        WAI`)
    expect([...mem.slice(0x50, 0x58)]).toEqual([0, 0x50, 0, 0x52, 0, 0x54, 0, 0x56])
  })

  it('shifts and rotates through carry', () => {
    const { cpu } = runCode(' ORG $100\n LDAA #$81\n ASLA\n ROLA\n LDAB #$01\n LSRB\n RORB\n WAI')
    expect(cpu.a).toBe(0x05)
    expect(cpu.b).toBe(0x80)
  })

  it('takes signed branches correctly', () => {
    const { cpu } = runCode(`
        ORG $100
        CLRB
        LDAA #$80       ; -128
        CMPA #$01
        BLT  OK1
        WAI
OK1     INCB
        CMPA #$01
        BHI  OK2        ; unsigned: $80 > $01
        WAI
OK2     INCB
        WAI`)
    expect(cpu.b).toBe(2)
  })

  it('stacks and restores everything across SWI and RTI', () => {
    const { cpu } = runCode(`
        ORG $100
        LDAA #$11
        LDAB #$22
        LDX #$3344
        SWI
        WAI
        ORG $200
HANDLER LDAA #$FF
        LDX #$FFFF
        RTI
        ORG $FFFA
        FDB HANDLER`)
    expect([cpu.a, cpu.b, cpu.x]).toEqual([0x11, 0x22, 0x3344])
  })
})

describe('assembler', () => {
  it('picks direct, extended, indexed and immediate modes', () => {
    const asm = assemble(' ORG $10\nV EQU $20\n LDAA V\n LDAA $1234\n LDAA 2,X\n LDA A #V\n STAA >V\n JMP V')
    expect(asm.errors).toEqual([])
    expect(asm.segments[0].bytes).toEqual([
      0x96, 0x20, 0xb6, 0x12, 0x34, 0xa6, 0x02, 0x86, 0x20, 0xb7, 0x00, 0x20, 0x7e, 0x00, 0x20,
    ])
  })

  it('reports unknown instructions, labels and far branches', () => {
    const asm = assemble(' FOO\n LDAA NOWHERE\n BRA FAR\n ORG $200\nFAR NOP')
    expect(asm.errors.map((e) => e.line)).toEqual([1, 2, 3])
  })
})

// ---- the trainer with the substitute monitor

const SETTLE = 60_000

function boot() {
  const t = new Trainer()
  t.loadRom(buildMonitor())
  t.run(SETTLE)
  return t
}

function tap(t: Trainer, ...keys: Key[]) {
  for (const k of keys) {
    t.press(k)
    t.run(SETTLE)
    t.release(k)
    t.run(SETTLE)
  }
}

const show = (t: Trainer) => displayText(t.segments)

describe('substitute monitor', () => {
  it('fits in 1K and announces itself', () => {
    expect(buildMonitor().length).toBe(1024)
    expect(show(boot())).toBe('CPU UP.')
  })

  it('enters bytes with AUTO and reads them back with EXAM, FWD, BACK', () => {
    const t = boot()
    tap(t, 0xa, 0, 0, 1, 0)
    expect(show(t)).toBe('0010__')
    tap(t, 8, 6, 4, 2)
    expect(show(t)).toBe('0012__')
    expect([...t.ram.slice(0x10, 0x12)]).toEqual([0x86, 0x42])
    tap(t, 'reset', 0xe, 0, 0, 1, 0)
    expect(show(t)).toBe('001086')
    tap(t, 0xf)
    expect(show(t)).toBe('001142')
    tap(t, 0xb)
    expect(show(t)).toBe('001086')
    tap(t, 0xc, 9, 9)
    expect(show(t)).toBe('001099')
    expect(t.ram[0x10]).toBe(0x99)
  })

  it('runs a program with DO and returns on SWI', () => {
    const t = boot()
    t.poke(assemble(' ORG 0\n LDAA #$12\n ADDA #$34\n STAA $20\n SWI').segments)
    tap(t, 0xd, 0, 0, 0, 0)
    expect(t.ram[0x20]).toBe(0x46)
    expect(show(t)).toBe('000700')
    tap(t, 1)
    expect(show(t)).toBe('AccA46')
  })

  it('single-steps, showing registers and flags', () => {
    const t = boot()
    t.poke(assemble(' ORG 0\n LDAA #$42\n LDAB #$37\n LDX #$1234\n CLRA').segments)
    tap(t, 8)
    expect(show(t)).toBe('0002C6')
    tap(t, 8)
    tap(t, 1)
    expect(show(t)).toBe('AccA42')
    tap(t, 2)
    expect(show(t)).toBe('Accb37')
    tap(t, 8, 4)
    expect(show(t)).toBe('In1234')
    tap(t, 3)
    expect(show(t)).toBe('Pc0007')
    tap(t, 8, 5)
    expect(show(t)).toBe('010100') // I and Z after CLRA
    tap(t, 6)
    expect(show(t)).toBe('SP00Ed')
  })

  it('changes a register with CHAN and resumes with RTI', () => {
    const t = boot()
    t.poke(assemble(' ORG $30\n STAA $50\n SWI').segments)
    tap(t, 1, 0xc, 5, 0xa)
    expect(show(t)).toBe('AccA5A')
    tap(t, 3, 0xc, 0, 0, 3, 0)
    expect(show(t)).toBe('Pc0030')
    tap(t, 7)
    expect(t.ram[0x50]).toBe(0x5a)
  })
})

describe('samples', () => {
  it('shows the sum on the display', () => {
    const t = boot()
    t.poke(assemble(SAMPLES[0].source).segments)
    tap(t, 0xd, 0, 0, 0, 0)
    expect(show(t)).toBe('000046')
  })

  it('adds two bytes typed on the keypad', () => {
    const t = boot()
    t.poke(assemble(SAMPLES[1].source).segments)
    tap(t, 0xd, 0, 0, 0, 0)
    expect(show(t)).toBe('      ')
    tap(t, 1, 2, 3, 4)
    expect(show(t)).toBe('123446')
    tap(t, 0xf, 0, 0, 5)
    expect(show(t)).toBe('F005F5')
  })

  it('guesses a number by halving the range', () => {
    const t = boot()
    t.poke(assemble(SAMPLES[2].source).segments)
    tap(t, 0xd, 0, 0, 0, 0)
    expect(show(t)).toBe('80    ')
    tap(t, 1)
    expect(show(t)).toBe('C0    ')
    tap(t, 3)
    expect(show(t)).toBe('A0    ')
    tap(t, 5) // not an answer: ignored
    expect(show(t)).toBe('A0    ')
    tap(t, 1, 2)
    expect(show(t)).toBe('b0  04')
    expect(t.cpu.waiting).toBe(true)
  })
})

describe('keying a program in', () => {
  it('produces RESET, AUTO, address, bytes, RESET', () => {
    expect(keystrokes([{ addr: 0x1c, bytes: [0x86, 0x0f] }])).toEqual([
      'reset', 0xa, 0, 0, 1, 0xc, 8, 6, 0, 0xf, 'reset',
    ])
  })

  it('loads every sample through the keypad exactly as poke would', () => {
    for (const sample of SAMPLES) {
      const asm = assemble(sample.source)
      expect(asm.errors, sample.name).toEqual([])
      const typed = boot()
      typed.type(keystrokes(asm.segments))
      for (let i = 0; i < 2000 && typed.typing; i++) typed.run(200_000)
      expect(typed.typing).toBe(false)
      const poked = boot()
      expect(poked.poke(asm.segments)).toBe(0)
      const end = Math.max(...asm.segments.map((s) => s.addr + s.bytes.length))
      expect([...typed.ram.slice(0, end)], sample.name).toEqual([...poked.ram.slice(0, end)])
    }
  })
})

describe('ROM check', () => {
  it('computes CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
})
