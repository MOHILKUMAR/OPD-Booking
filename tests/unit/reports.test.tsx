import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { csvCell, toCsv } from '@/lib/csv'
import type { Hospital } from '@/types/database'

const mocks = vi.hoisted(() => ({ fetchReportRows: vi.fn() }))
vi.mock('@/api/admin', () => ({ fetchReportRows: mocks.fetchReportRows }))
vi.mock('@/hooks/useHospital', () => ({
  useHospital: () => ({ data: { id: 'h1', name: 'Test Hospital' } as Hospital }),
}))

const { default: ReportsPage } = await import('@/pages/admin/ReportsPage')

describe('CSV', () => {
  it('quotes separators and neutralises spreadsheet formulas', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(12.5)).toBe('12.5')
    expect(csvCell('Rao, Asha')).toBe('"Rao, Asha"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"')
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`)
    expect(csvCell('+91 98765')).toBe("'+91 98765")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell(-5)).toBe('-5') // numbers are data, not formulas
  })

  it('writes a header row and CRLF lines in column order', () => {
    const csv = toCsv(
      [
        { key: 'b', header: 'Second' },
        { key: 'a', header: 'First' },
      ],
      [{ a: 1, b: 'x' }, { a: 2 }],
    )
    expect(csv).toBe('Second,First\r\nx,1\r\n,2\r\n')
  })
})

describe('Reports page', () => {
  const blobs: Blob[] = []
  beforeEach(() => {
    blobs.length = 0
    mocks.fetchReportRows.mockReset()
    URL.createObjectURL = vi.fn((b: Blob) => {
      blobs.push(b)
      return 'blob:report'
    })
    URL.revokeObjectURL = vi.fn()
  })

  function renderPage() {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    return render(
      <QueryClientProvider client={client}>
        <ReportsPage />
      </QueryClientProvider>,
    )
  }

  it('downloads the chosen report without patient details by default', async () => {
    mocks.fetchReportRows.mockResolvedValue({
      rows: [{ session_date: '2026-10-19', doctor: 'Dr. A', token_no: 1, status: 'COMPLETED' }],
      truncated: false,
    })
    renderPage()
    await userEvent.click(screen.getByRole('radio', { name: /Daily OPD summary/ }))
    expect(screen.queryByText(/Include patient name/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: /Appointments/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    await waitFor(() => expect(blobs).toHaveLength(1))
    const [hospitalId, kind, from, to, opts] = mocks.fetchReportRows.mock.calls[0]!
    expect([hospitalId, kind]).toEqual(['h1', 'appointments'])
    expect(from <= to).toBe(true)
    expect(opts.includePatient).toBe(false)
    const text = await blobs[0]!.text()
    // the file starts with a UTF-8 byte-order mark so Excel reads it as UTF-8 (text() drops it)
    const bytes = new Uint8Array(await blobs[0]!.arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(text).toMatch(/^Session date,Session,Doctor,Department,Token,/)
    expect(text).not.toMatch(/Patient name/)
  })

  it('adds patient columns only after the explicit opt-in, with a warning', async () => {
    mocks.fetchReportRows.mockResolvedValue({
      rows: [{ token_no: 1, patient_name: 'Asha Rao', patient_phone: '9876543210' }],
      truncated: false,
    })
    renderPage()
    await userEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByText('Contains personal data')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    await waitFor(() => expect(blobs).toHaveLength(1))
    expect(mocks.fetchReportRows.mock.calls[0]![4].includePatient).toBe(true)
    const text = await blobs[0]!.text()
    expect(text).toMatch(/Patient name,Mobile,Age/)
    expect(text).toMatch(/Asha Rao,9876543210/)
  })

  it('does not download an empty report and blocks reversed ranges', async () => {
    mocks.fetchReportRows.mockResolvedValue({ rows: [], truncated: false })
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    await waitFor(() => expect(mocks.fetchReportRows).toHaveBeenCalled())
    expect(blobs).toHaveLength(0)

    const from = screen.getByLabelText('From')
    await userEvent.clear(from)
    await userEvent.type(from, '2099-01-01')
    expect(screen.getByText(/Choose a start date on or before the end date/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeDisabled()
  })
})
