// The estimate template choice in Settings (decision D22). The database check
// on profiles.estimate_template only allows classic, slate, mint and editorial,
// so the Fieldhorse choice stays hidden until a migration adds the key. Picking
// it today would fail the whole Settings save.
import { expect, test } from '@playwright/test'
import { signIn } from './helpers/signIn'

test('the template choice offers only the four designs the database accepts', async ({ page, context }) => {
  await signIn(context)
  await page.goto('/settings')

  const picker = page.locator('#templates')
  await expect(picker).toBeAttached({ timeout: 20_000 })
  await expect(picker.locator('button')).toHaveText([/^Classic/, /^Slate/, /^Mint/, /^Editorial/])
})
