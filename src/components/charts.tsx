// Single-series charts for the admin dashboard. One validated colour (--series-1), thin marks,
// 4px rounded data ends, hairline recessive grid, hover tooltips and a table view for each chart.
import { Table2, BarChart3 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const AXIS = {
  stroke: 'var(--muted-foreground)',
  fontSize: 12,
  tickLine: false,
  axisLine: false,
} as const
const GRID = { stroke: 'var(--border)', strokeWidth: 1, vertical: false } as const

export interface Datum {
  label: string
  value: number
}

function ChartTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean
  payload?: { value: number }[]
  label?: string
  unit?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md">
      <p className="text-muted-foreground">{label}</p>
      <p className="flex items-center gap-2 font-semibold tabular">
        <span className="inline-block size-2.5 rounded-sm bg-series-1" aria-hidden />
        {payload[0]!.value.toLocaleString('en-IN')}
        {unit}
      </p>
    </div>
  )
}

export function ChartCard({
  title,
  subtitle,
  data,
  valueLabel,
  unit = '',
  children,
}: {
  title: string
  subtitle?: string
  data: Datum[]
  valueLabel: string
  unit?: string
  children: ReactNode
}) {
  const [asTable, setAsTable] = useState(false)
  const empty = data.every((d) => d.value === 0)
  return (
    <Card className="gap-3">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setAsTable(!asTable)}
          aria-label={asTable ? `Show ${title} as chart` : `Show ${title} as table`}
          title={asTable ? 'Chart view' : 'Table view'}
        >
          {asTable ? <BarChart3 /> : <Table2 />}
        </Button>
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="flex h-56 items-center justify-center text-sm text-muted-foreground">
            No data in this range yet.
          </p>
        ) : asTable ? (
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-1 font-medium">Label</th>
                  <th className="py-1 text-right font-medium">{valueLabel}</th>
                </tr>
              </thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.label} className="border-b last:border-0">
                    <td className="py-1">{d.label}</td>
                    <td className="py-1 text-right tabular">
                      {d.value.toLocaleString('en-IN')}
                      {unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div
            className="h-56"
            role="img"
            aria-label={`${title}. Use the table view for exact values.`}
          >
            {children}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** Axis numbers: 0 / 950 / 1.2K */
function compact(v: number): string {
  return Math.abs(v) >= 1000 ? `${+(v / 1000).toFixed(1)}K` : String(v)
}

/** Single-line category label, truncated with a full-text tooltip (no wrapping). */
function CategoryTick({
  x = 0,
  y = 0,
  payload,
}: {
  x?: number
  y?: number
  payload?: { value: string }
}) {
  const full = payload?.value ?? ''
  const text = full.length > 24 ? `${full.slice(0, 23)}…` : full
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fontSize={12} fill="var(--muted-foreground)">
      <title>{full}</title>
      {text}
    </text>
  )
}

export function ColumnChart({ data, unit }: { data: Datum[]; unit?: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap={2}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={12} />
        <YAxis {...AXIS} allowDecimals={false} width={44} tickFormatter={compact} />
        <Tooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
          content={<ChartTooltip unit={unit} />}
        />
        <Bar dataKey="value" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={24} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function HorizontalBarChart({ data, unit }: { data: Datum[]; unit?: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
        barCategoryGap={2}
      >
        <CartesianGrid {...GRID} vertical horizontal={false} />
        <XAxis type="number" {...AXIS} allowDecimals={false} tickFormatter={compact} />
        <YAxis
          type="category"
          dataKey="label"
          {...AXIS}
          width={170}
          interval={0}
          tick={<CategoryTick />}
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
          content={<ChartTooltip unit={unit} />}
        />
        <Bar dataKey="value" fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={24} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function TrendLineChart({ data, unit }: { data: Datum[]; unit?: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={12} />
        <YAxis {...AXIS} width={44} tickFormatter={compact} />
        <Tooltip
          cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1 }}
          content={<ChartTooltip unit={unit} />}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke="var(--series-1)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          dot={false}
          activeDot={{ r: 5, fill: 'var(--series-1)', stroke: 'var(--card)', strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
