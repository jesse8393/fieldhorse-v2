// Signs a browser context in against the mocked Supabase project
// (scripts/qa-mock.mjs) and seeds the theme mode once, so a reload keeps
// whatever a test switched to. Pass tables to replace whole mock tables
// for this context, and role to test what crew or field roles see.
import type { BrowserContext } from '@playwright/test'
import { installMock, session } from '../../../scripts/qa-mock.mjs'

export type SignInOptions = {
  mode?: 'auto' | 'day' | 'night'
  tables?: Partial<Record<string, object[]>>
  role?: string
}

export async function signIn(context: BrowserContext, { mode = 'day', tables, role }: SignInOptions = {}) {
  await installMock(context, {
    supabaseHosts: ['qa-mock.supabase.co', 'pnmhblvslftdzfcdezbw.supabase.co'],
    tables,
    role
  })
  await context.addInitScript(([savedSession, themeMode]) => {
    localStorage.setItem('sb-qa-mock-auth-token', JSON.stringify(savedSession))
    localStorage.setItem('sb-pnmhblvslftdzfcdezbw-auth-token', JSON.stringify(savedSession))
    if (!localStorage.getItem('fh:theme-mode')) localStorage.setItem('fh:theme-mode', themeMode)
    localStorage.setItem('fh-onboarding-seen', '1')
  }, [session, mode] as const)
}
