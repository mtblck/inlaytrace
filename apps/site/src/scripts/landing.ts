/**
 * The landing page's one moment of motion: the badge tilts into an isometric
 * view, each of its traced shapes lifts onto its own layer and drifts apart,
 * hovers, then settles back flush and the board tilts flat again, showing the
 * pieces are separate and fit exactly. It runs once on load and again on
 * "Lift the pieces". With reduced motion the board stays flat and the button
 * is hidden.
 */
const board = document.getElementById('board')
const replay = document.getElementById('replay') as HTMLButtonElement | null
const still = matchMedia('(prefers-reduced-motion: reduce)')
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const layers = board?.querySelectorAll('.layer').length ?? 0
let running = false

async function lift() {
  if (!board || running || still.matches) return
  running = true
  if (replay) replay.disabled = true
  board.classList.add('iso') // tilt
  await wait(800)
  board.classList.add('lifted') // rise, bottom layer first
  await wait(1000 + layers * 35 + 1300) // and hover
  board.classList.remove('lifted') // settle, top layer first
  await wait(1000 + layers * 35)
  board.classList.remove('iso') // flat again
  await wait(900)
  running = false
  if (replay) replay.disabled = false
}

replay?.addEventListener('click', lift)
if (still.matches && replay) replay.hidden = true
else setTimeout(lift, 700)

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
