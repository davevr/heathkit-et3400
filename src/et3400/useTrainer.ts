import { useCallback, useEffect, useState } from 'react'
import { CLOCK_HZ, crc32, HEATH_ROM_CRC, ROM_SIZE, Trainer } from './machine.ts'
import { buildMonitor } from './monitor.ts'

export interface RomInfo {
  /** File name, or null for the built-in substitute monitor. */
  name: string | null
  /** True when the image matches the original Heath monitor. */
  original: boolean
}

const ROM_KEY = 'et3400.rom'
const ROM_NAME_KEY = 'et3400.romName'

function storedRom(): { image: Uint8Array; name: string } | null {
  try {
    const data = localStorage.getItem(ROM_KEY)
    if (!data) return null
    const image = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    if (image.length !== ROM_SIZE) return null
    return { image, name: localStorage.getItem(ROM_NAME_KEY) ?? 'ROM image' }
  } catch {
    return null
  }
}

const info = (image: Uint8Array, name: string | null): RomInfo => ({
  name,
  original: crc32(image) === HEATH_ROM_CRC,
})

// One machine for the page; React only watches it.
const trainer = new Trainer()
const saved = storedRom()
trainer.loadRom(saved?.image ?? buildMonitor())
const initialRom = saved ? info(saved.image, saved.name) : info(trainer.rom, null)

export function useTrainer(keyingSpeed: number) {
  const [, setFrame] = useState(0)
  const [rom, setRom] = useState<RomInfo>(initialRom)

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    // The clock follows wall time, not frames: browsers slow or stop animation
    // frames for pages they consider hidden, so a timer keeps it running too.
    const advance = () => {
      const now = performance.now()
      const elapsed = Math.min(Math.max(now - last, 0), 1000) / 1000
      last = now
      trainer.run(elapsed * CLOCK_HZ * (trainer.typing ? keyingSpeed : 1))
      setFrame((f) => f + 1)
    }
    const frame = () => {
      advance()
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    const timer = setInterval(() => {
      if (performance.now() - last > 100) advance()
    }, 50)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(timer)
    }
  }, [keyingSpeed])

  /** Install a ROM file. Throws with a readable message if it is not a 1K image. */
  const installRom = useCallback((bytes: Uint8Array, name: string) => {
    // A 2K dump of the ET-3400A's 2316 holds the monitor in its upper half.
    const image = bytes.length === ROM_SIZE * 2 ? bytes.slice(ROM_SIZE) : bytes
    if (image.length !== ROM_SIZE) {
      throw new Error(`${name} is ${bytes.length} bytes. The monitor ROM is ${ROM_SIZE} bytes.`)
    }
    trainer.loadRom(image)
    try {
      localStorage.setItem(ROM_KEY, btoa(String.fromCharCode(...image)))
      localStorage.setItem(ROM_NAME_KEY, name)
    } catch {
      // the ROM still works for this visit
    }
    setRom(info(image, name))
  }, [])

  const removeRom = useCallback(() => {
    trainer.loadRom(buildMonitor())
    try {
      localStorage.removeItem(ROM_KEY)
      localStorage.removeItem(ROM_NAME_KEY)
    } catch {
      // nothing stored
    }
    setRom(info(trainer.rom, null))
  }, [])

  return { trainer, rom, installRom, removeRom }
}
