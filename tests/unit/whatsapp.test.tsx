import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookingView } from '@/types/database'

const mocks = vi.hoisted(() => ({ setWhatsappAlerts: vi.fn() }))
vi.mock('@/api/bookings', () => ({ setWhatsappAlerts: mocks.setWhatsappAlerts }))

const { WhatsAppUpdatesCard } = await import('@/components/whatsapp-updates')

const booking = (whatsapp: BookingView['whatsapp']) =>
  ({
    booking_reference: 'MQ-7K3P9XQ2',
    patient_phone_masked: 'XXXXXX5466',
    hospital: { name: 'MediQueue Demo Hospital' },
    whatsapp,
  }) as unknown as BookingView

function renderCard(b: BookingView) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <WhatsAppUpdatesCard booking={b} accessKey="key123" />
    </QueryClientProvider>,
  )
}

describe('WhatsApp updates card', () => {
  beforeEach(() => mocks.setWhatsappAlerts.mockReset())

  it('is hidden when the hospital does not offer WhatsApp', () => {
    const { container } = renderCard(booking({ available: false, enabled: false, language: 'en' }))
    expect(container).toBeEmptyDOMElement()
  })

  it('asks for explicit consent, naming the masked number and hospital', async () => {
    mocks.setWhatsappAlerts.mockResolvedValue({ enabled: true, language: 'en' })
    renderCard(booking({ available: true, enabled: false, language: 'en' }))
    expect(screen.getByText(/WhatsApp message to XXXXXX5466/)).toBeInTheDocument()
    expect(
      screen.getByText(/receive these messages from MediQueue Demo Hospital/),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Send me WhatsApp updates' }))
    await waitFor(() =>
      expect(mocks.setWhatsappAlerts).toHaveBeenCalledWith('MQ-7K3P9XQ2', 'key123', true, 'en'),
    )
  })

  it('lets the patient turn it off, even after the hospital stops offering it', async () => {
    mocks.setWhatsappAlerts.mockResolvedValue({ enabled: false, language: 'hi' })
    renderCard(booking({ available: false, enabled: true, language: 'hi' }))
    expect(screen.getByText('WhatsApp updates are on')).toBeInTheDocument()
    expect(screen.getByText(/in Hindi/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }))
    await waitFor(() =>
      expect(mocks.setWhatsappAlerts).toHaveBeenCalledWith('MQ-7K3P9XQ2', 'key123', false, 'en'),
    )
  })
})
