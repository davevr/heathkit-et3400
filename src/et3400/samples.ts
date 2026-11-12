// Sample programs. They use only the display hardware and the monitor's REDIS,
// INCH, IHB, OUTBYT and OUTCH, which the substitute monitor keeps at Heath's addresses.

export interface Sample {
  name: string
  blurb: string
  source: string
}

export const SAMPLES: Sample[] = [
  {
    name: 'Add two numbers',
    blurb: 'DO 0000. The display shows the sum, 000046. Press RESET when done.',
    source: `* Add two numbers and show the sum on the display.
        ORG $0000
        LDAA #$12
        ADDA #$34
        STAA SUM
        JSR REDIS       ; back to the left-hand digit
        CLRA
        JSR OUTBYT      ; 00
        CLRA
        JSR OUTBYT      ; 00
        LDAA SUM
        JSR OUTBYT      ; the answer
        WAI             ; stop here; press RESET
SUM     RMB 1
* Monitor routines
REDIS   EQU $FCBC
OUTBYT  EQU $FE20
`,
  },
  {
    name: 'Add what you type',
    blurb: 'DO 0000, then key in two hex bytes, such as 12 and 34. The sum appears to their right. Keep going with two more.',
    source: `* Read two hex bytes from the keypad and show their sum.
* The display reads: first number, second number, sum.
        ORG $0000
START   JSR REDIS       ; back to the left-hand digit
        JSR IHB         ; two keys -> first number in A
        STAA FIRST
        JSR IHB         ; two keys -> second number in A
        ADDA FIRST
        JSR OUTBYT      ; the sum
        BRA START       ; and again; RESET to stop
FIRST   RMB 1
* Monitor routines
REDIS   EQU $FCBC
IHB     EQU $FE09       ; input hex byte, echoed on the display
OUTBYT  EQU $FE20
`,
  },
  {
    name: 'Guess my number',
    blurb: 'Think of a number from 01 to FF, then DO 0000. For each guess press 1 if it is too low, 3 if too high, 2 if correct. The count of guesses then appears on the right.',
    source: `* The computer guesses your number, 01 to FF, by halving the range.
* After each guess press 1 = too low, 2 = correct, 3 = too high.
        ORG $0000
        LDAA #1
        STAA LO
        LDAA #$FF
        STAA HI
        CLR COUNT
NEXT    LDAA LO
        ADDA HI         ; the carry is the ninth bit of the sum
        RORA            ; so this halves it: the middle of the range
        STAA GUESS
        INC COUNT
        JSR REDIS
        LDAA GUESS
        JSR OUTBYT      ; show the guess
KEY     JSR INCH        ; wait for a key
        CMPA #1
        BEQ LOW
        CMPA #3
        BEQ HIGH
        CMPA #2
        BNE KEY         ; anything else: ask again
        CLRA
        JSR OUTCH       ; two blank digits
        CLRA
        JSR OUTCH
        LDAA COUNT
        JSR OUTBYT      ; how many guesses it took
        WAI             ; press RESET
LOW     LDAA GUESS      ; too low: search above the guess
        INCA
        STAA LO
        BRA NEXT
HIGH    LDAA GUESS      ; too high: search below it
        DECA
        STAA HI
        BRA NEXT
LO      RMB 1
HI      RMB 1
GUESS   RMB 1
COUNT   RMB 1
* Monitor routines
REDIS   EQU $FCBC
INCH    EQU $FDF4       ; wait for a key, return it in A
OUTBYT  EQU $FE20
OUTCH   EQU $FE3A       ; show the segment pattern in A
`,
  },
  {
    name: 'Segment chase',
    blurb: 'DO 0000. A lit segment runs around the left digit until RESET.',
    source: `* Chase one segment around the left-hand digit.
* Each segment has its own latch: C166 is segment a, down to C161 for f.
        ORG $0000
START   LDX #$C166
NEXT    LDAA #1
        STAA 0,X        ; segment on
        BSR DELAY
        CLRA
        STAA 0,X        ; segment off
        DEX
        CPX #$C160      ; past f?
        BNE NEXT
        BRA START
DELAY   LDAB #$30
D1      DECA
        BNE D1
        DECB
        BNE D1
        RTS
`,
  },
  {
    name: 'Count in binary',
    blurb: 'DO 0000. The six digits count up in binary, 0s and 1s, until RESET.',
    source: `* A six-bit binary counter across the display.
        ORG $0000
        CLR COUNT
LOOP    LDAB COUNT
        ASLB
        ASLB            ; bit 5 is now at the top
        LDX #$C16F      ; left digit
        STX DIGIT
BITS    LDAA #$7E       ; pattern for 0
        ASLB
        BCC SHOW
        LDAA #$30       ; pattern for 1
SHOW    BSR OUT
        LDAA DIGIT+1
        SUBA #$10       ; next digit to the right
        STAA DIGIT+1
        CMPA #$0F
        BNE BITS
        INC COUNT
        LDX #$6000
WAIT    DEX
        BNE WAIT
        BRA LOOP
* Write pattern A (dp a b c d e f g) to the digit, one segment at a time.
OUT     PSHB
        LDX DIGIT
        LDAB #8
O1      ROLA
        PSHA
        LDAA #0
        ROLA
        STAA 0,X
        PULA
        DEX
        DECB
        BNE O1
        PULB
        RTS
COUNT   RMB 1
DIGIT   RMB 2
`,
  },
]
