/**
 * The hero loop: a muted video of how Inlay works. It plays unless the reader
 * prefers reduced motion (then the poster frame stays and the button offers
 * Play), and the button pauses and resumes it, since it moves for longer than
 * five seconds.
 */
const video = document.getElementById('hero-video') as HTMLVideoElement | null
const toggle = document.getElementById('replay') as HTMLButtonElement | null
const still = matchMedia('(prefers-reduced-motion: reduce)')

function label() {
  if (toggle && video) toggle.textContent = video.paused ? 'Play' : 'Pause'
}
if (video && toggle) {
  video.addEventListener('play', label)
  video.addEventListener('pause', label)
  toggle.addEventListener('click', () => {
    if (video.paused) video.play().catch(label)
    else video.pause()
    label() // paused changes at once; the events come a moment later
  })
  if (!still.matches) video.play().catch(label)
  label()
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
