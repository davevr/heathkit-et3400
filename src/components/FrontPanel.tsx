import type { Key, Trainer } from '../et3400/machine.ts'

const KEY_ROWS: { hex: number; fn: string }[][] = [
  [{ hex: 0xd, fn: 'DO' }, { hex: 0xe, fn: 'EXAM' }, { hex: 0xf, fn: 'FWD' }],
  [{ hex: 0xa, fn: 'AUTO' }, { hex: 0xb, fn: 'BACK' }, { hex: 0xc, fn: 'CHAN' }],
  [{ hex: 0x7, fn: 'RTI' }, { hex: 0x8, fn: 'SS' }, { hex: 0x9, fn: 'BR' }],
  [{ hex: 0x4, fn: 'INDEX' }, { hex: 0x5, fn: 'CC' }, { hex: 0x6, fn: 'SP' }],
  [{ hex: 0x1, fn: 'ACCA' }, { hex: 0x2, fn: 'ACCB' }, { hex: 0x3, fn: 'PC' }],
]

const FLAGS = ['H', 'I', 'N', 'Z', 'V', 'C']

// ---- seven-segment digit, 40 x 72 before scaling and the slant

const T = 7
const hseg = (x: number, y: number, len: number) =>
  `${x},${y} ${x + T / 2},${y - T / 2} ${x + len - T / 2},${y - T / 2} ${x + len},${y} ${x + len - T / 2},${y + T / 2} ${x + T / 2},${y + T / 2}`
const vseg = (x: number, y: number, len: number) =>
  `${x},${y} ${x + T / 2},${y + T / 2} ${x + T / 2},${y + len - T / 2} ${x},${y + len} ${x - T / 2},${y + len - T / 2} ${x - T / 2},${y + T / 2}`

// index = latch bit: 0 g, 1 f, 2 e, 3 d, 4 c, 5 b, 6 a
const SEGMENT_SHAPES = [
  hseg(5, 36, 30),
  vseg(4, 5, 30),
  vseg(4, 37, 30),
  hseg(5, 68, 30),
  vseg(36, 37, 30),
  vseg(36, 5, 30),
  hseg(5, 4, 30),
]

function Digit({ x, y, pattern }: { x: number; y: number; pattern: number }) {
  return (
    <g>
      <rect className="module" x={x} y={y} width={44} height={68} rx={2} />
      <g transform={`translate(${x + 8} ${y + 8}) scale(0.72) skewX(-6)`}>
        {SEGMENT_SHAPES.map((points, bit) => (
          <polygon key={bit} points={points} className={pattern & (1 << bit) ? 'seg on' : 'seg'} />
        ))}
        <circle cx={45} cy={68} r={3.6} className={pattern & 0x80 ? 'seg on' : 'seg'} />
      </g>
    </g>
  )
}

function KeyCap(props: { x: number; y: number; label: string; fn?: string; id: Key; down: boolean; trainer: Trainer }) {
  const { x, y, label, fn, id, down, trainer } = props
  return (
    <g
      className={`key${down ? ' down' : ''}`}
      transform={`translate(${x} ${y + (down ? 2 : 0)})`}
      role="button"
      aria-label={fn ? `${label} ${fn}` : label}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        trainer.cancelTyping()
        trainer.press(id)
      }}
      onPointerUp={() => trainer.release(id)}
      onPointerCancel={() => trainer.release(id)}
    >
      <rect className="key-shadow" x={0} y={3} width={52} height={52} rx={4} />
      <rect className="key-skirt" x={0} y={0} width={52} height={52} rx={4} />
      <rect className="key-top" x={5} y={4} width={42} height={41} rx={3} />
      {fn && (
        <text className="key-fn" x={26} y={16}>
          {fn}
        </text>
      )}
      <text className={id === 'reset' ? 'key-hex small' : 'key-hex'} x={26} y={fn ? 38 : id === 'reset' ? 29 : 33}>
        {label}
      </text>
    </g>
  )
}

// ---- board furniture; everything below is drawn for the look and not wired

/** A DIP package lying across (pins top and bottom) or standing (pins left and right). */
function Dip({ x, y, pins, standing, name }: { x: number; y: number; pins: number; standing?: boolean; name?: string }) {
  const side = pins / 2
  const len = side * 6.5 + 3
  const legs = Array.from({ length: side }, (_, i) => 3 + i * 6.5)
  return (
    <g transform={`translate(${x} ${y})${standing ? ' rotate(90)' : ''}`}>
      {legs.map((p) => (
        <g key={p}>
          <rect className="pin" x={p} y={-4} width={2.6} height={5} />
          <rect className="pin" x={p} y={19} width={2.6} height={5} />
        </g>
      ))}
      <rect className="chip" width={len} height={20} rx={1.5} />
      <circle className="chip-notch" cx={4} cy={10} r={2.2} />
      {name && (
        <text className="chip-label" x={len / 2 + 2} y={13}>
          {name}
        </text>
      )}
    </g>
  )
}

/** One of the white solderless connector blocks. */
function Block({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const cols = Math.max(1, Math.floor(w / 7))
  const rows = Math.max(1, Math.floor(h / 7))
  const dots = []
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      dots.push(
        <rect
          key={`${c}-${r}`}
          x={x + (w - cols * 7) / 2 + c * 7 + 2}
          y={y + (h - rows * 7) / 2 + r * 7 + 2}
          width={3}
          height={3}
        />,
      )
    }
  }
  return (
    <g>
      <rect className="block" x={x} y={y} width={w} height={h} rx={2} />
      <g className="holes">{dots}</g>
    </g>
  )
}

function Breadboard({ x, y }: { x: number; y: number }) {
  const holes = []
  for (let col = 0; col < 38; col++) {
    for (let row = 0; row < 10; row++) {
      holes.push(
        <rect key={`${col}-${row}`} x={x + 9 + col * 7.4} y={y + 9 + row * 7.4 + (row >= 5 ? 14 : 0)} width={3} height={3} />,
      )
    }
  }
  return (
    <g>
      <rect className="breadboard" x={x} y={y} width={298} height={104} rx={3} />
      <rect className="breadboard-gutter" x={x + 6} y={y + 47} width={286} height={10} rx={2} />
      <g className="holes">{holes}</g>
    </g>
  )
}

export function FrontPanel({ trainer }: { trainer: Trainer }) {
  const down = new Set<Key>(trainer.pressed())
  const kx = 556
  const ky = 396

  return (
    <svg className="panel" viewBox="0 0 800 790" role="img" aria-label="ET-3400 microprocessor trainer">
      <defs>
        <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id="case" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3d72c4" />
          <stop offset="1" stopColor="#2c5cab" />
        </linearGradient>
      </defs>

      {/* case, vents, nameplate */}
      <rect width={800} height={790} rx={14} fill="url(#case)" />
      {[0, 1].map((group) =>
        Array.from({ length: 6 }, (_, i) => (
          <rect key={`${group}-${i}`} className="vent" x={228 + group * 216} y={18 + i * 8} width={128} height={4} rx={2} />
        )),
      )}
      <rect className="nameplate" x={40} y={84} width={720} height={84} rx={3} />
      <circle className="power-led" cx={90} cy={124} r={6} />
      <text className="plate-small" x={156} y={106}>
        power
      </text>
      <rect className="power-switch" x={132} y={112} width={48} height={26} rx={2} />
      <rect className="power-rocker" x={158} y={115} width={19} height={20} rx={1} />
      <text className="plate-small" x={132} y={156}>
        standby
      </text>
      <text className="plate-small" x={182} y={156}>
        on
      </text>
      <text className="plate-brand" x={200} y={134}>
        HEATHKIT
      </text>
      <text className="plate-line" x={352} y={134}>
        microcomputer learning system
      </text>

      {/* the recess and the board */}
      <rect className="recess" x={48} y={196} width={704} height={566} rx={6} />
      <path className="pcb" d="M60 206 H740 V384 H544 V752 H60 Z" />
      <g className="tracks">
        <path d="M60 290 H740 M222 290 V384 M404 290 V384 M482 290 V384 M604 290 V384 M60 384 H544 M60 512 H232 V752 M232 512 H544 M330 384 V512" />
      </g>

      {/* RAM and the display */}
      <Dip x={76} y={222} pins={16} />
      <Dip x={138} y={222} pins={16} />
      <Dip x={212} y={222} pins={16} />
      <Dip x={274} y={222} pins={16} />
      <text className="silk" x={130} y={272}>
        RAM (0000)
      </text>
      <text className="silk" x={266} y={272}>
        RAM (0100)
      </text>
      {Array.from(trainer.segments, (pattern, i) => (
        <g key={i}>
          <Digit x={452 + i * 47} y={212} pattern={pattern} />
          <text className="silk flag" x={474 + i * 47} y={289}>
            {FLAGS[i]}
          </text>
        </g>
      ))}

      {/* second row: data I/O, CPU, model, ROM, key buffer */}
      <text className="silk" x={184} y={308}>
        Data I/O
      </text>
      <Dip x={100} y={318} pins={14} standing />
      <Dip x={144} y={318} pins={14} standing />
      <Block x={158} y={322} w={52} h={16} />
      <Block x={158} y={352} w={52} h={16} />
      <text className="silk" x={312} y={308}>
        CPU
      </text>
      <Dip x={246} y={326} pins={40} name="MC6800" />
      <rect className="model-box" x={412} y={298} width={62} height={78} rx={2} />
      <text className="silk model" x={443} y={332}>
        Model
      </text>
      <text className="silk model" x={443} y={352}>
        ET-3400
      </text>
      <text className="silk" x={540} y={308}>
        ROM (FC00)
      </text>
      <Dip x={500} y={326} pins={24} name="444-13" />
      <text className="silk" x={672} y={308}>
        Key Buffer
      </text>
      <Dip x={690} y={318} pins={14} standing />

      {/* third row: control and address buffers */}
      <text className="silk" x={282} y={452}>
        Control
      </text>
      <text className="silk" x={282} y={466}>
        Buffers
      </text>
      <Block x={70} y={400} w={40} h={16} />
      <Dip x={128} y={430} pins={14} />
      <Dip x={204} y={398} pins={16} standing />
      <Dip x={378} y={398} pins={16} standing />
      <Dip x={438} y={398} pins={16} standing />
      <text className="silk" x={490} y={410}>
        Address Buffers
      </text>
      {['RST', 'R/W', 'NMI', 'HA'].map((label, i) => (
        <text key={label} className="silk tiny" x={250 + i * 22} y={480}>
          {label}
        </text>
      ))}
      {['A15', 'A12', 'A11', 'A8', 'A7', 'A4', 'A3', 'A0'].map((label, i) => (
        <text key={label} className="silk tiny" x={350 + i * 26} y={480}>
          {label}
        </text>
      ))}
      <Block x={240} y={486} w={38} h={20} />
      <Block x={284} y={486} w={38} h={20} />
      {[0, 1, 2, 3].map((i) => (
        <Block key={i} x={338 + i * 51} y={486} w={46} h={20} />
      ))}

      {/* data LEDs, their connectors, the DIP switch */}
      {Array.from({ length: 8 }, (_, i) => (
        <g key={i}>
          <rect className="data-led" x={74 + i * 19} y={524} width={12} height={14} rx={5} />
          <Block x={73 + i * 19} y={546} w={14} h={54} />
        </g>
      ))}
      <Dip x={76} y={628} pins={16} />
      <Block x={74} y={672} w={52} h={22} />
      <Block x={136} y={672} w={52} h={22} />
      <rect className="dip-switch" x={84} y={712} width={72} height={24} rx={2} />
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={i} className="dip-lever" x={89 + i * 8.2} y={722} width={5} height={10} />
      ))}
      <text className="silk tiny" x={120} y={720}>
        7 6 5 4 3 2 1 0
      </text>
      <text className="silk tiny" x={206} y={622}>
        +5
      </text>
      {[0, 1, 2, 3].map((i) => (
        <Block key={i} x={190} y={628 + i * 28} w={36} h={22} />
      ))}
      <text className="silk" x={252} y={716}>
        Pwr
      </text>

      <Breadboard x={240} y={524} />
      <Dip x={272} y={704} pins={14} />
      <rect className="edge-connector" x={338} y={706} width={132} height={14} rx={7} />
      <Dip x={484} y={704} pins={14} />

      {/* keypad */}
      {KEY_ROWS.map((row, r) =>
        row.map((k, c) => (
          <KeyCap
            key={k.hex}
            x={kx + c * 60}
            y={ky + r * 60}
            id={k.hex}
            label={k.hex.toString(16).toUpperCase()}
            fn={k.fn}
            down={down.has(k.hex)}
            trainer={trainer}
          />
        )),
      )}
      <KeyCap x={kx + 30} y={ky + 300} id={0} label="0" down={down.has(0)} trainer={trainer} />
      <KeyCap x={kx + 90} y={ky + 300} id="reset" label="RESET" down={down.has('reset')} trainer={trainer} />
    </svg>
  )
}
