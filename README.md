# ET-3400 trainer simulator

A React simulator of the Heathkit ET-3400 Microprocessor Trainer (1976): a
Motorola 6800, 256 bytes of RAM, a hex keypad and six seven-segment LEDs.

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # CPU, assembler, monitor and keyed-in loading tests
```

- `src/et3400/cpu6800.ts` – the MC6800, every documented opcode.
- `src/et3400/machine.ts` – the board: RAM at 0000, keypad at C0xx, the display
  latches at C1xx (one write per segment), ROM at FC00.
- `src/et3400/assembler.ts` – a two-pass 6800 assembler for the editor.
- `src/et3400/monitor.ts` – a substitute monitor, written in 6800 assembly.
- `src/components/FrontPanel.tsx` – the front panel, drawn in SVG.

## The monitor ROM

Heath's 1K monitor is not included. Without it the trainer runs the substitute
monitor, which handles ACCA, ACCB, PC, INDEX, CC, SP, EXAM, FWD, BACK, CHAN,
AUTO, DO, RTI and SS, but not BR. Of the monitor's routines only REDIS (FCBC),
INCH (FDF4), IHB (FE09), OUTBYT (FE20), OUTHEX (FE28) and OUTCH (FE3A) are at their original addresses.

To run the original, use **Load ROM file…** and pick a 1,024-byte dump of IC12
(`et3400.bin` / `et3400.ic12`, CRC-32 `2EFF1F58`). It is kept in the browser's
local storage; `*.bin` and `*.ic12` are git-ignored.

## Loading programs

Write assembly in the editor, then either **Key it in** (the simulator presses
RESET, AUTO, the address and every byte on the keypad, as you would have) or
**Load instantly**. The breadboard, data LEDs and switches are drawn but not wired.
