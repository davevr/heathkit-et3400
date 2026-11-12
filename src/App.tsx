import { useEffect, useState } from 'react'
import { FrontPanel } from './components/FrontPanel.tsx'
import { Workbench } from './components/Workbench.tsx'
import type { Key } from './et3400/machine.ts'
import { useTrainer } from './et3400/useTrainer.ts'

function keyFor(e: KeyboardEvent): Key | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null
  if (e.key === 'Escape') return 'reset'
  return /^[0-9a-f]$/i.test(e.key) ? parseInt(e.key, 16) : null
}

export default function App() {
  const [fast, setFast] = useState(false)
  const { trainer, rom, installRom, removeRom } = useTrainer(fast ? 6 : 1)

  // The computer's keyboard works the keypad, except while typing in a field.
  useEffect(() => {
    const typingInField = (e: KeyboardEvent) =>
      e.target instanceof HTMLElement && /^(TEXTAREA|INPUT|SELECT)$/.test(e.target.tagName)
    const down = (e: KeyboardEvent) => {
      const key = keyFor(e)
      if (key === null || e.repeat || typingInField(e)) return
      trainer.cancelTyping()
      trainer.press(key)
    }
    const up = (e: KeyboardEvent) => {
      const key = keyFor(e)
      if (key !== null) trainer.release(key)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [trainer])

  return (
    <main>
      <FrontPanel trainer={trainer} />
      <Workbench
        trainer={trainer}
        rom={rom}
        installRom={installRom}
        removeRom={removeRom}
        fast={fast}
        setFast={setFast}
      />
    </main>
  )
}
