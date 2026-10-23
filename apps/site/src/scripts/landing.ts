/**
 * The hero's split: the range input (and a drag on the picture itself) moves the
 * line between the pixels and the shapes. On load it sweeps once from the
 * pixels to the middle, unless the reader prefers reduced motion.
 */
const compare = document.getElementById('compare')
const range = document.getElementById('compare-range') as HTMLInputElement | null
const still = matchMedia('(prefers-reduced-motion: reduce)')

if (compare && range) {
  const set = (pos: number) => {
    const p = Math.min(100, Math.max(0, pos))
    compare.style.setProperty('--pos', `${p}%`)
    range.value = String(Math.round(p))
  }
  let sweep = 0
  range.addEventListener('input', () => {
    cancelAnimationFrame(sweep)
    set(Number(range.value))
  })
  const fromPointer = (e: PointerEvent) => {
    const r = compare.getBoundingClientRect()
    set(((e.clientX - r.left) / r.width) * 100)
  }
  compare.addEventListener('pointerdown', (e) => {
    cancelAnimationFrame(sweep)
    compare.setPointerCapture(e.pointerId)
    fromPointer(e)
  })
  compare.addEventListener('pointermove', (e) => compare.hasPointerCapture(e.pointerId) && fromPointer(e))
  if (!still.matches) {
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 1400)
      set(92 - 42 * (1 - (1 - t) ** 3))
      if (t < 1) sweep = requestAnimationFrame(step)
    }
    sweep = requestAnimationFrame(step)
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
  button.addEventListener('click', async () => {
    const text = document.getElementById(button.dataset.copy!)?.textContent ?? ''
    try {
      await navigator.clipboard.writeText(text)
      button.textContent = 'Copied'
    } catch {
      // No permission, or not a secure context: say how to copy instead.
      button.textContent = 'Select and copy'
    }
    setTimeout(() => (button.textContent = 'Copy'), 1500)
  })
}
