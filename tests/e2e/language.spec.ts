import { expect, test } from '@playwright/test'
import { mockSupabase } from './mock-api'

test('the interface switches to Hindi and remembers the choice', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await page.getByRole('button', { name: 'हिन्दी में देखें' }).click()

  await expect(page.locator('html')).toHaveAttribute('lang', 'hi')
  await expect(page.getByRole('link', { name: 'टोकन बुक करें' }).first()).toBeVisible()
  await expect(
    page.getByText('आपात स्थिति में सीधे इमरजेंसी विभाग जाएँ', { exact: false }),
  ).toBeVisible()
  // hospital data stays as entered
  await expect(page.getByText('Dr. Asha Rao (Demo)').first()).toBeVisible()

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi')
  await page.getByRole('button', { name: 'View in English' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(
    page.getByText('For emergencies, go directly to the emergency department', { exact: false }),
  ).toBeVisible()
})

test('a ?lang=hi link opens the waiting-room display in Hindi', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/display?lang=hi')
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi')
  await expect(page.getByText('Dr. Asha Rao (Demo)').first()).toBeVisible()
})
