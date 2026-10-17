import { expect, test } from '@playwright/test'
import { mockSupabase } from './mock-api'

test('waiting-room display shows token numbers and no patient details', async ({ page }) => {
  const state = await mockSupabase(page)
  await page.goto('/display')
  await expect(
    page.getByRole('heading', { level: 1, name: 'MediQueue Demo Hospital' }),
  ).toBeVisible()
  await expect(page.getByText('Dr. Asha Rao (Demo)')).toBeVisible()
  await expect(page.getByText('Now serving').first()).toBeVisible()
  await expect(page.getByText('12', { exact: true })).toBeVisible()
  await expect(page.getByText(/Running about 15 min late/)).toBeVisible()
  const text = await page.locator('body').innerText()
  expect(text).not.toMatch(/\d{10}/) // no phone numbers
  expect(text).not.toMatch(/patient/i)
  // the board only ever calls the PII-free function
  expect(
    state.calls
      .filter((c) => c.url.includes('/rpc/'))
      .every((c) => c.url.endsWith('/rpc/get_display_board')),
  ).toBe(true)
})

test('staff and admin areas require sign-in', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/admin/settings')
  await expect(page).toHaveURL(/\/staff\/login\?next=%2Fadmin%2Fsettings/)
  await expect(
    page.getByRole('heading', { name: 'Staff sign in' }).or(page.getByText('Staff sign in')),
  ).toBeVisible()
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()
  await page.goto('/staff/queue')
  await expect(page).toHaveURL(/\/staff\/login/)
})
