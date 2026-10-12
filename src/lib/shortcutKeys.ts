// Desktop shortcut labels that follow the keyboard in front of the person
// (PHASE8_PLAN.md Task 13, D33). The command key is ⌘ on a Mac and Ctrl
// everywhere else, so the sidebar prints "⌘J" or "Ctrl J" (no dash, per
// the copy rules), says "Command J" or "Control J" to a screen reader,
// and declares "Meta+J" or "Control+J" in aria-keyshortcuts. The handlers
// themselves (CaptureSheet for J, CommandPalette for K) accept either
// modifier, so only the label changes by platform. The platform test is
// the one shortcutModifier in lib/paletteActions.ts uses for Option and
// Alt.

export type ShortcutEnv = { userAgent?: string }

export type DesktopShortcut = {
  /** The keys as printed on the key cap, such as "⌘J" or "Ctrl J". */
  keys: string
  /** What a screen reader says, such as "Command J" or "Control J". */
  spoken: string
  /** The aria-keyshortcuts value, such as "Meta+J" or "Control+J". */
  combo: string
}

/** The browser's environment, or nothing outside a browser (tests, SSR). */
export function browserEnv(): ShortcutEnv {
  return typeof navigator === 'undefined' ? {} : { userAgent: navigator.userAgent }
}

/** True on a Mac, or an iPad or iPhone, where the command key is ⌘. */
export function isMacLike(env: ShortcutEnv = {}): boolean {
  return /Macintosh|iPad|iPhone|iPod/.test(env.userAgent ?? '')
}

/** The command key plus one letter, labelled for the platform in `env`. */
export function desktopShortcut(letter: string, env: ShortcutEnv = {}): DesktopShortcut {
  const key = letter.toUpperCase()
  return isMacLike(env)
    ? { keys: `⌘${key}`, spoken: `Command ${key}`, combo: `Meta+${key}` }
    : { keys: `Ctrl ${key}`, spoken: `Control ${key}`, combo: `Control+${key}` }
}
