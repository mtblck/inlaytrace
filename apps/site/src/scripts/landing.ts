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

/**
 * Phones: the three close-ups become a row you swipe through (CSS scroll snap). The buttons above
 * scroll to one, and follow the swipe to show which is in view. Wider screens show all three and hide the buttons.
 * Offsets are the figures' own: .trio is positioned, so it is their offsetParent.
 */
const trio = document.getElementById('trio')
const tabs = [...document.querySelectorAll<HTMLButtonElement>('.trio-tabs button')]
if (trio && tabs.length) {
  const figures = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls')!)!)
  const mark = (i: number) => tabs.forEach((t, j) => t.setAttribute('aria-pressed', String(i === j)))
  tabs.forEach((t, i) =>
    t.addEventListener('click', () => {
      mark(i)
      trio.scrollTo({ left: figures[i].offsetLeft - (trio.clientWidth - figures[i].offsetWidth) / 2, behavior: still.matches ? 'auto' : 'smooth' })
    }),
  )
  let frame = 0
  trio.addEventListener('scroll', () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      const mid = trio.scrollLeft + trio.clientWidth / 2
      let best = 0
      figures.forEach((f, i) => {
        if (Math.abs(f.offsetLeft + f.offsetWidth / 2 - mid) < Math.abs(figures[best].offsetLeft + figures[best].offsetWidth / 2 - mid)) best = i
      })
      mark(best)
    })
  })
}
