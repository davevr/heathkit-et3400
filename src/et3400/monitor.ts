// A substitute monitor for the ET-3400, written for this simulator so the
// trainer works without Heath's copyrighted ROM. It is not Heath's code. Only
// REDIS (FCBC), INCH (FDF4), IHB (FE09), OUTBYT (FE20), OUTHEX (FE28) and OUTCH
// (FE3A) keep their original addresses;
// load the real ROM for programs that call anything else in it.
//
// Supported keys: ACCA ACCB PC INDEX CC SP, EXAM FWD BACK CHAN, AUTO, DO, RTI,
// SS. BR does nothing. SWI returns to the monitor showing the next address.

import { assemble } from './assembler.ts'
import { ROM_BASE, ROM_SIZE } from './machine.ts'

export const MONITOR_SOURCE = `
* Page-zero workspace. The user's stack starts just below it.
CNT     EQU $EE
KEY     EQU $EF
USP     EQU $F0         ; stack pointer of the stacked user registers
ADDR    EQU $F2         ; address being examined
DIGP    EQU $F4         ; next display digit (points at its dp latch)
TMPX    EQU $F6
SPTR    EQU $F8
TMP     EQU $FA
TMP2    EQU $FB
BTMP    EQU $FC
MODE    EQU $FD         ; 1 memory, 2 byte register, 3 word register
REGOFF  EQU $FE
LASTK   EQU $FF

        ORG $FC00
RESET   LDS #$00ED
        CLRA
        LDAB #6
RS1     PSHA            ; a blank set of user registers, PC = 0000
        DECB
        BNE RS1
        LDAA #$D0
        PSHA
        STS USP
        CLR MODE
        JSR HOME
        LDX #MSGUP
        LDAB #6
        JSR OUTSTR

CMD     LDS USP
        JSR GETKEY
DISP    STAA KEY
        ASLA
        LDX #JTAB
        JSR ADDAX
        LDX 0,X
        JMP 0,X

* SWI and the single-step NMI arrive here with the registers stacked.
BREAK   STS USP
        LDX USP
        LDX 6,X
        STX ADDR
        JMP SHOWM

EXAM    JSR GETADR
SHOWM   JSR SHOWAD
        LDX ADDR
        LDAA 0,X
        JSR OUTBYT
        LDAA #1
        STAA MODE
        JMP CMD

FWD     LDAA MODE
        CMPA #1
        BNE CMDJ
        LDX ADDR
        INX
        STX ADDR
        BRA SHOWM

BACK    LDAA MODE
        CMPA #1
        BNE CMDJ
        LDX ADDR
        DEX
        STX ADDR
        BRA SHOWM
CMDJ    JMP CMD

AUTO    JSR GETADR
AU1     JSR SHOWAD
        JSR PROMP2
        JSR GETBYT
        LDX ADDR
        STAA 0,X
        INX
        STX ADDR
        BRA AU1

DO      JSR GETADR
        JSR HOME        ; clear the display for the program
        LDX #MBLANK
        LDAB #6
        JSR OUTSTR
        JSR HOME
        LDX USP
        LDAA ADDR
        STAA 6,X
        LDAA ADDR+1
        STAA 7,X
GO      LDS USP
        RTI

SSK     LDS USP
        STAA $C200      ; arm the one-instruction NMI
        RTI

* REDIS, INCH, IHB, OUTBYT, OUTHEX and OUTCH sit at the same addresses as in Heath's monitor,
* so programs that call them run on either.
        ORG $FCBC
REDIS
HOME    LDX #$C16F
        STX DIGP
        RTS

CHAN    LDAA MODE
        CMPA #1
        BNE CHREG
        JSR PROMP2
        JSR GETBYT
        LDX ADDR
        STAA 0,X
        JMP SHOWM
CHREG   CMPA #2
        BNE CH16
        JSR PROMP2
        JSR GETBYT
        PSHA
        JSR REGPTR
        PULA
        STAA 0,X
        BRA REDO
CH16    CMPA #3
        BNE CHX
        LDX #$C14F
        STX DIGP
        LDX #MPROM
        LDAB #4
        JSR OUTSTR
        LDX #$C14F
        STX DIGP
        JSR GETBYT
        PSHA
        JSR REGPTR
        PULA
        STAA 0,X
        JSR GETBYT
        PSHA
        JSR REGPTR
        PULA
        STAA 1,X
REDO    LDAA LASTK
        JMP DISP
CHX     JMP CMD

ACCA    LDX #MACCA
        LDAA #3
        BRA REG8
ACCB    LDX #MACCB
        LDAA #2
REG8    STAA REGOFF
        LDAA #2
        STAA MODE
        LDAA KEY
        STAA LASTK
        STX SPTR
        JSR HOME
        LDX SPTR
        LDAB #4
        JSR OUTSTR
        JSR REGPTR
        LDAA 0,X
        JSR OUTBYT
        JMP CMD

PCK     LDX #MPC
        LDAA #6
        BRA REG16
INDEX   LDX #MIN
        LDAA #4
REG16   STAA REGOFF
        LDAA #3
        STAA MODE
        LDAA KEY
        STAA LASTK
        STX SPTR
        JSR HOME
        LDX SPTR
        LDAB #2
        JSR OUTSTR
        JSR REGPTR
        LDAA 0,X
        JSR OUTBYT
        JSR REGPTR
        LDAA 1,X
        JSR OUTBYT
        JMP CMD

SPK     CLR MODE
        JSR HOME
        LDX #MSP
        LDAB #2
        JSR OUTSTR
        LDAA USP+1
        LDAB USP
        ADDA #7
        ADCB #0
        PSHA
        TBA
        JSR OUTBYT
        PULA
        JSR OUTBYT
        JMP CMD

* CC: one digit per flag, over the H I N Z V C legends.
CCK     CLR MODE
        JSR HOME
        LDX USP
        LDAB 1,X
        ASLB
        ASLB
        LDAA #6
        STAA CNT
CC1     ASLB
        LDAA #0
        ADCA #0
        JSR OUTHEX
        DEC CNT
        BNE CC1
        JMP CMD

* ---- subroutines

REGPTR  LDX USP
        LDAA REGOFF
ADDAX   STX TMPX        ; X = X + A
        ADDA TMPX+1
        STAA TMPX+1
        BCC AX1
        INC TMPX
AX1     LDX TMPX
        RTS

GETADR  JSR HOME        ; prompt for and read a four-digit address
        LDX #MPROM
        LDAB #6
        JSR OUTSTR
        JSR HOME
        JSR GETBYT
        STAA ADDR
        JSR GETBYT
        STAA ADDR+1
        RTS

        ORG $FDF4
INCH    JMP GETKEY      ; wait for a key, return it in A

        ORG $FE09
IHB     JMP GETBYT      ; two keys, echoed, to a byte in A

        ORG $FE20
OUTBYT  PSHA
        LSRA
        LSRA
        LSRA
        LSRA
        BSR OUTHEX
        PULA
OUTHEX  ANDA #$0F
        LDX #HEXTAB
        JSR ADDAX
        LDAA 0,X
        BRA OUTCH

        ORG $FE3A
OUTCH
OUTPAT  PSHB            ; A = dp a b c d e f g; one latch write per segment
        LDX DIGP
        LDAB #8
OP1     ROLA
        PSHA
        LDAA #0
        ROLA
        STAA 0,X
        PULA
        DEX
        DECB
        BNE OP1
        LDAA DIGP+1
        SUBA #$10
        STAA DIGP+1
        PULB
        RTS

GETKEY  JSR SCAN        ; wait for release, then a debounced press
        BPL GETKEY
        JSR DELAY
GK1     JSR SCAN
        BMI GK1
        STAA TMP2
        JSR DELAY
        JSR SCAN
        CMPA TMP2
        BNE GK1
        RTS

SCAN    LDAB $C006      ; A = key, or negative when none is down
        LDX #KT0
        BSR DEC
        BPL SCX
        LDAB $C005
        LDX #KT1
        BSR DEC
        BPL SCX
        LDAB $C003
        LDX #KT2
        BSR DEC
SCX     RTS
DEC     LDAA #6
        STAA TMP
DEC1    LSRB
        BCC DEC2
        INX
        DEC TMP
        BNE DEC1
        LDAA #$FF
        RTS
DEC2    LDAA 0,X
        RTS

DELAY   LDX #$0300
DL1     DEX
        BNE DL1
        RTS

GETBYT  JSR GETKEY      ; two keys, echoed, to a byte in A
        PSHA
        JSR OUTHEX
        PULA
        ASLA
        ASLA
        ASLA
        ASLA
        STAA BTMP
        JSR GETKEY
        PSHA
        JSR OUTHEX
        PULA
        ORAA BTMP
        RTS

OUTSTR  STX SPTR        ; B segment patterns from X
OS1     LDX SPTR
        LDAA 0,X
        INX
        STX SPTR
        JSR OUTPAT
        DECB
        BNE OS1
        RTS

PROMP2  LDX #$C12F      ; two prompts in the data digits
        STX DIGP
        LDAA #$08
        JSR OUTPAT
        LDAA #$08
        JSR OUTPAT
        LDX #$C12F
        STX DIGP
        RTS

SHOWAD  JSR HOME
        LDAA ADDR
        JSR OUTBYT
        LDAA ADDR+1
        JMP OUTBYT

MSGUP   FCB $4E,$67,$3E,$00,$3E,$E7     ; CPU UP.
MPROM   FCB $08,$08,$08,$08,$00,$00
MBLANK  FCB $00,$00,$00,$00,$00,$00
MACCA   FCB $77,$0D,$0D,$77
MACCB   FCB $77,$0D,$0D,$1F
MPC     FCB $67,$0D
MIN     FCB $30,$15
MSP     FCB $5B,$67
HEXTAB  FCB $7E,$30,$6D,$79,$33,$5B,$5F,$70,$7F,$7B,$77,$1F,$4E,$3D,$4F,$47
KT0     FCB $0D,$0A,$07,$04,$01,$00
KT1     FCB $0E,$0B,$08,$05,$02,$FF
KT2     FCB $0F,$0C,$09,$06,$03,$FF
JTAB    FDB CMD,ACCA,ACCB,PCK,INDEX,CCK,SPK,GO
        FDB SSK,CMD,AUTO,BACK,CHAN,DO,EXAM,FWD

        ORG $FFF8
        FDB BREAK,BREAK,BREAK,RESET
`

/** Assemble the substitute monitor into a 1K ROM image. */
export function buildMonitor(): Uint8Array {
  const result = assemble(MONITOR_SOURCE)
  if (result.errors.length) {
    const e = result.errors[0]
    throw new Error(`Monitor source, line ${e.line}: ${e.message}`)
  }
  const image = new Uint8Array(ROM_SIZE).fill(0xff)
  const used = new Set<number>()
  for (const seg of result.segments) {
    seg.bytes.forEach((b, i) => {
      const addr = seg.addr + i
      if (used.has(addr)) throw new Error(`Monitor source overlaps itself at ${addr.toString(16)}`)
      used.add(addr)
      image[addr - ROM_BASE] = b
    })
  }
  const at = (label: string, addr: number) => {
    if (result.symbols.get(label) !== addr) throw new Error(`${label} is not at ${addr.toString(16)}`)
  }
  at('REDIS', 0xfcbc)
  at('INCH', 0xfdf4)
  at('IHB', 0xfe09)
  at('OUTCH', 0xfe3a)
  at('OUTBYT', 0xfe20)
  at('OUTHEX', 0xfe28)
  return image
}
