import { browserEnv, desktopShortcut } from '../../lib/shortcutKeys.ts'
import type { DesktopShortcut } from '../../lib/shortcutKeys.ts'

// The command palette's shortcut in the older desktop search bars (the
// Snow*Build headers, Team, Crew, Tasks, Timesheets, the sub portal and
// the shared BuildTopbar). They used to print a fixed ⌘K on every
// computer; now the key cap follows the keyboard in front of the person
// the way the sidebar's does (D33): ⌘K on a Mac, Ctrl K elsewhere. The
// palette itself opens on either modifier.

/** ⌘K on a Mac and Ctrl K elsewhere, with its spoken form and aria-keyshortcuts value. */
export function paletteShortcut(): DesktopShortcut {
  return desktopShortcut('K', browserEnv())
}

/** The key cap at the end of an older desktop search bar. */
export default function PaletteKeyCap() {
  return <kbd>{paletteShortcut().keys}</kbd>
}
