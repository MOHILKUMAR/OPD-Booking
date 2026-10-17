import { AlertTriangle, Inbox, Loader2, Radio, RefreshCw, WifiOff } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { LiveStatus } from '@/hooks/useLiveQueue'
import { localeFor, useT } from '@/i18n'
import { common } from '@/i18n/common'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

export function PageSpinner({ label }: { label?: string }) {
  const t = useT(common)
  return (
    <div
      className="flex min-h-[40vh] items-center justify-center gap-2 text-muted-foreground"
      role="status"
    >
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span>{label ?? t('loading')}…</span>
    </div>
  )
}

export function CardSkeletons({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid gap-4', className)} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-40 w-full rounded-xl" />
      ))}
    </div>
  )
}

export function ErrorState({
  error,
  onRetry,
  title,
}: {
  error: unknown
  onRetry?: () => void
  title?: string
}) {
  const t = useT(common)
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-10 text-center"
    >
      <AlertTriangle className="size-8 text-destructive" aria-hidden />
      <div>
        <p className="font-medium">{title ?? t('somethingWrong')}</p>
        <p className="text-sm text-muted-foreground">{errorMessage(error)}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw /> {t('tryAgain')}
        </Button>
      )}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-12 text-center">
      {icon ?? <Inbox className="size-8 text-muted-foreground" aria-hidden />}
      <div>
        <p className="font-medium">{title}</p>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function LiveIndicator({
  status,
  updatedAt,
  className,
}: {
  status: LiveStatus
  updatedAt?: number
  className?: string
}) {
  const t = useT(common)
  const label = t(status === 'live' ? 'live' : status === 'connecting' ? 'connecting' : 'polling')
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-xs text-muted-foreground', className)}
      aria-live="polite"
    >
      {status === 'polling' ? (
        <WifiOff className="size-3.5" aria-hidden />
      ) : (
        <Radio
          className={cn('size-3.5', status === 'live' && 'text-success animate-pulse')}
          aria-hidden
        />
      )}
      {label}
      {updatedAt ? (
        <span className="tabular">
          ·{' '}
          {t('updatedAt', {
            time: new Date(updatedAt).toLocaleTimeString(localeFor(), {
              hour: 'numeric',
              minute: '2-digit',
              second: '2-digit',
            }),
          })}
        </span>
      ) : null}
    </span>
  )
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}
