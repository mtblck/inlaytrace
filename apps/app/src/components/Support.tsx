import { tipjar } from 'tipjar'
import 'tipjar/style.css'

/** Where tips go: the same Ko-fi page as the site's footer and the README. */
export const SUPPORT_URL = 'https://ko-fi.com/mtblck'

// tipjar() escapes everything and checks the link, so its markup is safe to set
// as HTML. Built once: nothing in it changes. Themed in index.css (.tipjar).
const markup = tipjar({
  href: SUPPORT_URL,
  label: 'Support',
  description: 'Inlay on Ko-fi',
  icon: 'heart',
  position: 'inline',
  newTab: true,
})

/**
 * The header's tip button. Inlay is free; this is the one way to give back.
 * Inline beside the theme toggle rather than floating, so it never covers the
 * canvas or the phone's export bar. Icon-only under 600px (tipjar's `auto`).
 */
export function Support() {
  return <span className="ml-1 inline-flex" dangerouslySetInnerHTML={{ __html: markup }} />
}
