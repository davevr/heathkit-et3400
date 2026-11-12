import { useMemo, useRef, useState } from 'react'
import { assemble } from '../et3400/assembler.ts'
import { keystrokes, type Trainer } from '../et3400/machine.ts'
import { SAMPLES } from '../et3400/samples.ts'
import type { RomInfo } from '../et3400/useTrainer.ts'

// Bumped when the built-in samples change, so a saved copy of an old one is dropped.
const SOURCE_KEY = 'et3400.source.v2'
const hex = (v: number, digits: number) => v.toString(16).toUpperCase().padStart(digits, '0')

function initialSource(): string {
  try {
    return localStorage.getItem(SOURCE_KEY) ?? SAMPLES[0].source
  } catch {
    return SAMPLES[0].source
  }
}

interface Props {
  trainer: Trainer
  rom: RomInfo
  installRom: (bytes: Uint8Array, name: string) => void
  removeRom: () => void
  fast: boolean
  setFast: (fast: boolean) => void
}

export function Workbench({ trainer, rom, installRom, removeRom, fast, setFast }: Props) {
  const [source, setSource] = useState(initialSource)
  const [note, setNote] = useState('')
  const [romError, setRomError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const asm = useMemo(() => assemble(source), [source])
  const byteCount = asm.segments.reduce((n, s) => n + s.bytes.length, 0)
  const outside = asm.segments.reduce(
    (n, s) => n + s.bytes.filter((_, i) => s.addr + i >= trainer.ramSize).length,
    0,
  )
  const keys = useMemo(() => keystrokes(asm.segments), [asm])
  const start = asm.segments[0]?.addr ?? 0
  const ready = asm.errors.length === 0 && byteCount > 0 && outside === 0
  const { left, total } = trainer.typingProgress

  const edit = (text: string) => {
    setSource(text)
    setNote('')
    try {
      localStorage.setItem(SOURCE_KEY, text)
    } catch {
      // not saved; the editor still works
    }
  }

  const runHint = `To run it: DO (D), then ${hex(start, 4)}.`

  return (
    <div className="bench">
      <section className="card editor">
        <header>
          <h2>Program</h2>
          <select
            value=""
            onChange={(e) => {
              const sample = SAMPLES.find((s) => s.name === e.target.value)
              if (sample) {
                edit(sample.source)
                setNote(sample.blurb)
              }
            }}
          >
            <option value="">Load a sample…</option>
            {SAMPLES.map((s) => (
              <option key={s.name}>{s.name}</option>
            ))}
          </select>
        </header>
        <div className="split">
          <textarea
            value={source}
            onChange={(e) => edit(e.target.value)}
            spellCheck={false}
            aria-label="6800 assembly source"
          />
          <pre className="listing" aria-label="Assembled bytes">
            {asm.listing
              .filter((l) => l.bytes.length)
              .map((l) => `${hex(l.addr ?? 0, 4)}  ${l.bytes.map((b) => hex(b, 2)).join(' ')}`)
              .join('\n') || ' '}
          </pre>
        </div>

        {asm.errors.length > 0 && (
          <ul className="errors">
            {asm.errors.slice(0, 4).map((e) => (
              <li key={e.line}>
                Line {e.line}: {e.message}
              </li>
            ))}
          </ul>
        )}
        {asm.errors.length === 0 && outside > 0 && (
          <p className="errors">
            {outside} of {byteCount} bytes fall outside the trainer's RAM (0000–{hex(trainer.ramSize - 1, 4)}).
          </p>
        )}

        <div className="actions">
          {trainer.typing ? (
            <>
              <button onClick={() => trainer.cancelTyping()}>Stop</button>
              <span className="status">
                Keying it in… {total - left} of {total} presses
              </span>
            </>
          ) : (
            <>
              <button
                className="primary"
                disabled={!ready}
                onClick={() => {
                  trainer.type(keys)
                  setNote(runHint)
                }}
              >
                Key it in
              </button>
              <button
                disabled={!ready}
                onClick={() => {
                  trainer.poke(asm.segments)
                  setNote(`Loaded ${byteCount} bytes. ${runHint}`)
                }}
              >
                Load instantly
              </button>
              <span className="status">
                {ready ? `${byteCount} bytes, ${keys.length} key presses by hand` : ''}
              </span>
            </>
          )}
          <label className="fast">
            <input type="checkbox" checked={fast} onChange={(e) => setFast(e.target.checked)} />
            Fast fingers
          </label>
        </div>
        {note && <p className="note">{note}</p>}
      </section>

      <section className="card">
        <header>
          <h2>Memory</h2>
          <span className="status">0000–00FF</span>
        </header>
        <pre className="memory">
          {Array.from({ length: 16 }, (_, row) => (
            <span key={row}>
              <b>{hex(row * 16, 4)}</b>
              {Array.from({ length: 16 }, (_, col) => {
                const v = trainer.ram[row * 16 + col]
                return (
                  <span key={col} className={v ? 'set' : ''}>
                    {' '}
                    {hex(v, 2)}
                  </span>
                )
              })}
              {'\n'}
            </span>
          ))}
        </pre>
      </section>

      <section className="card">
        <header>
          <h2>Monitor ROM</h2>
        </header>
        <p>
          {rom.name === null
            ? 'Running the built-in substitute monitor. BR is not supported, and only its basic keypad and display routines are at their original addresses.'
            : rom.original
              ? `${rom.name} matches the original ET-3400 monitor.`
              : `${rom.name} is loaded. It does not match the known ET-3400 monitor image.`}
        </p>
        <div className="actions">
          <button onClick={() => fileInput.current?.click()}>Load ROM file…</button>
          {rom.name !== null && <button onClick={removeRom}>Use substitute</button>}
          <input
            ref={fileInput}
            type="file"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              try {
                installRom(new Uint8Array(await file.arrayBuffer()), file.name)
                setRomError('')
              } catch (err) {
                setRomError((err as Error).message)
              }
            }}
          />
        </div>
        {romError && <p className="errors">{romError}</p>}
        <h3>Keys</h3>
        <dl className="keys">
          <dt>AUTO</dt>
          <dd>address, then bytes one after another; RESET to finish</dd>
          <dt>EXAM</dt>
          <dd>address; then FWD, BACK, or CHAN and a new byte</dd>
          <dt>DO</dt>
          <dd>address to run from</dd>
          <dt>SS</dt>
          <dd>run one instruction</dd>
          <dt>ACCA … SP</dt>
          <dd>show a register; CHAN to change it</dd>
        </dl>
        <p className="status">Your keyboard works too: 0–9, A–F, and Esc for RESET.</p>
      </section>
    </div>
  )
}
