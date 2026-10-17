// CSV for spreadsheet exports (Excel, Google Sheets, LibreOffice).

export interface CsvColumn {
  key: string
  header: string
}

/**
 * One CSV cell. Text that a spreadsheet would run as a formula (= + - @, tab, carriage return)
 * gets a leading apostrophe, so a patient name or note can never execute in Excel.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(columns: CsvColumn[], rows: Record<string, unknown>[]): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(',')]
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c.key])).join(','))
  return `${lines.join('\r\n')}\r\n`
}

/** Saves text as a .csv download. The byte-order mark makes Excel read UTF-8 (₹, Hindi). */
export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
