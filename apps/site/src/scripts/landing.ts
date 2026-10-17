/**
 * The landing page's one moment of motion: the badge's pieces start lifted out
 * of place and settle into the board, showing they share every edge. It runs
 * once on load and again on "Lift the pieces". With reduced motion the pieces
 * simply sit in place.
 */
const board = document.querySelector<SVGSVGElement>('.board')
const replay = document.getElementById('replay')
const still = matchMedia('(prefers-reduced-motion: reduce)')

function settle() {
  if (!board || still.matches) return
  board.classList.add('apart')
  // Two frames: the lifted position must be painted before the transition starts.
  requestAnimationFrame(() => requestAnimationFrame(() => board.classList.remove('apart')))
}

if (board && !still.matches) {
  board.classList.add('apart')
  setTimeout(() => board.classList.remove('apart'), 450)
}
replay?.addEventListener('click', settle)
if (still.matches && replay) replay.hidden = true

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
  button.addEventListener('click', async () => {
    const text = document.getElementById(button.dataset.copy!)?.textContent ?? ''
    await navigator.clipboard.writeText(text)
    button.textContent = 'Copied'
    setTimeout(() => (button.textContent = 'Copy'), 1500)
  })
}
