import { expect, test, type Page } from '@playwright/test'
import { KEY, mockSupabase, REF } from './mock-api'

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(overflow, 'page must not scroll sideways').toBeLessThanOrEqual(1)
}

test('home page shows hospital, live OPD status and booking entry points', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/')
  await expect(
    page.getByRole('heading', { level: 1, name: 'MediQueue Demo Hospital' }),
  ).toBeVisible()
  await expect(page.getByText(/OPD session.*running now/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Book a token' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Track my token' })).toBeVisible()
  await expect(page.getByText('Demo environment')).toBeVisible()
  await expect(page.getByText('Dr. Asha Rao (Demo)').first()).toBeVisible()
  await expectNoHorizontalScroll(page)
})

test('patient books a token, sees confirmation, and tracks it with polling fallback', async ({
  page,
}) => {
  const state = await mockSupabase(page)
  await page.goto('/doctors?available=1')
  await expect(page.getByRole('heading', { name: 'Find a doctor' })).toBeVisible()
  await expectNoHorizontalScroll(page)

  await page.getByRole('main').getByRole('link', { name: 'Book token' }).first().click()
  await expect(page.getByRole('heading', { name: 'Book a token' })).toBeVisible()
  // the full evening session is shown but cannot be chosen
  await expect(page.getByRole('radio', { name: /Evening OPD/ })).toBeDisabled()
  await expect(page.getByRole('radio', { name: /Today · Morning OPD/ })).toHaveAttribute(
    'aria-checked',
    'true',
  )

  await page.getByLabel('Patient name').fill('Ravi Kumar')
  await page.getByLabel('Mobile number').fill('98765 4321') // 9 digits
  await page.getByLabel('Age').fill('41')
  await page.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(page.getByText('Enter a valid 10-digit Indian mobile number')).toBeVisible()
  expect(state.calls.some((c) => c.url.endsWith('/rpc/book_token'))).toBe(false)

  await page.getByLabel('Mobile number').fill('+91 98765 43210')
  await page.getByRole('checkbox').check()
  await expectNoHorizontalScroll(page)
  await page.getByRole('button', { name: 'Confirm booking' }).click()

  await expect(page).toHaveURL(new RegExp(`/booking/${REF}#k=${KEY}$`))
  await expect(page.getByRole('heading', { name: 'Token booked' })).toBeVisible()
  await expect(page.getByText('13', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Save your tracking link')).toBeVisible()

  const bookCall = state.calls.find((c) => c.url.endsWith('/rpc/book_token'))!
  expect(bookCall.body).toMatchObject({
    p_patient_name: 'Ravi Kumar',
    p_patient_phone: '9876543210',
    p_patient_age: 41,
  })
  expect(Object.keys(bookCall.body as object)).not.toContain('p_fee_paise')
  expect(state.calls.some((c) => c.url.endsWith('/auth/v1/signup'))).toBe(true) // anonymous session, no OTP

  await page.getByRole('link', { name: 'Track my token' }).click()
  await expect(page.getByRole('heading', { name: 'Token tracking' })).toBeVisible()
  await expect(page.getByText('R*** K****')).toBeVisible()
  await expect(page.getByText('XXXXXX3210')).toBeVisible()
  // Realtime is not reachable in this test, so the page must fall back to polling
  await expect(page.getByText(/Auto-refresh every 15 s/)).toBeVisible({ timeout: 15_000 })
  await expectNoHorizontalScroll(page)

  // the secret key is never sent in a URL, only in RPC bodies
  for (const c of state.calls) expect(c.url).not.toContain(KEY)
})

test('a patient can cancel an eligible booking', async ({ page }) => {
  await mockSupabase(page)
  await page.goto(`/track/${REF}#k=${KEY}`)
  await page.getByRole('button', { name: 'Cancel this booking' }).click()
  await page.getByLabel('Reason (optional)').fill('Feeling better')
  await page.getByRole('button', { name: 'Cancel booking' }).click()
  await expect(page.getByText('Booking cancelled.')).toBeVisible()
  await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible()
})

test('an incomplete tracking link reveals nothing', async ({ page }) => {
  await mockSupabase(page)
  await page.route('**/rpc/get_booking', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: 'null',
      headers: { 'access-control-allow-origin': '*' },
    }),
  )
  await page.goto(`/track/${REF}`)
  await expect(
    page
      .getByRole('heading', { name: 'Booking not found' })
      .or(page.getByText('Booking not found')),
  ).toBeVisible()
  await expect(page.getByText('R*** K****')).toHaveCount(0)
})
