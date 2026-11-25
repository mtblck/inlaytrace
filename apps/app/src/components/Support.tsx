import { tipjar } from 'tipjar'
import 'tipjar/style.css'

/** Where tips go: the same Ko-fi page as the site's footer and the README. */
export const SUPPORT_URL = 'https://ko-fi.com/mtblck'
/** Inlay's source, for a star. */
export const SOURCE_URL = 'https://github.com/mtblck/inlaytrace'

// tipjar() escapes everything and checks the links, so its markup is safe to set
// as HTML. Built once: nothing in it changes. Themed in index.css (.tipjar).
// With `links` the button opens a menu (the browser's popover, no script). No star
// count: fetching it from the browser needs api.github.com in the CSP's connect-src.
const markup = tipjar({
  label: 'Support',
  icon: 'heart',
  position: 'inline',
  newTab: true,
  menuId: 'support-menu',
  links: [
    { href: SUPPORT_URL, label: 'Tip on Ko-fi', icon: 'coffee' },
    { href: SOURCE_URL, label: 'Star on GitHub', icon: 'star' },
  ],
})

/**
 * The header's tip button, a menu of Ko-fi and the GitHub repo. Inlay is free;
 * this is the one way to give back. Inline beside the theme toggle rather than
 * floating, so it never covers the canvas or the phone's export bar. Icon-only
 * under 600px (tipjar's `auto`).
 */
export function Support() {
  return <span className="ml-1 inline-flex" dangerouslySetInnerHTML={{ __html: markup }} />
}
