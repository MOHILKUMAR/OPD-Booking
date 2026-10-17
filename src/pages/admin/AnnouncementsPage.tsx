import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { deleteAnnouncement, fetchAllAnnouncements, saveAnnouncement } from '@/api/admin'
import { ToneBadge } from '@/components/badges'
import { EmptyState, ErrorState, PageHeader, PageSpinner } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useHospital } from '@/hooks/useHospital'
import { errorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import type { Announcement, AnnouncementKind } from '@/types/database'

const KINDS: Record<AnnouncementKind, string> = {
  GENERAL: 'General',
  DOCTOR_DELAY: 'Doctor delay',
  OPD_CANCELLED: 'OPD cancelled',
  HOLIDAY: 'Holiday',
  SCHEDULE_CHANGE: 'Schedule change',
}

interface Draft {
  id?: string
  kind: AnnouncementKind
  title: string
  body: string
  is_published: boolean
  show_on_display: boolean
  expires: string
}

export default function AnnouncementsPage() {
  const { data: hospital } = useHospital()
  const queryClient = useQueryClient()
  const list = useQuery({
    queryKey: ['admin-announcements', hospital?.id],
    queryFn: () => fetchAllAnnouncements(hospital!.id),
    enabled: !!hospital,
  })
  const [draft, setDraft] = useState<Draft | null>(null)
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-announcements'] })
    void queryClient.invalidateQueries({ queryKey: ['announcements'] })
  }

  const save = useMutation({
    mutationFn: (d: Draft) =>
      saveAnnouncement({
        id: d.id,
        hospital_id: hospital!.id,
        kind: d.kind,
        title: d.title.trim(),
        body: d.body.trim(),
        doctor_id: null,
        is_published: d.is_published,
        show_on_display: d.show_on_display,
        expires_at: d.expires ? new Date(d.expires).toISOString() : null,
      }),
    onSuccess: () => {
      toast.success('Announcement saved')
      setDraft(null)
      invalidate()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: deleteAnnouncement,
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e)),
  })

  const edit = (a?: Announcement) =>
    setDraft(
      a
        ? {
            id: a.id,
            kind: a.kind,
            title: a.title,
            body: a.body,
            is_published: a.is_published,
            show_on_display: a.show_on_display,
            expires: a.expires_at ? a.expires_at.slice(0, 16) : '',
          }
        : {
            kind: 'GENERAL',
            title: '',
            body: '',
            is_published: true,
            show_on_display: true,
            expires: '',
          },
    )

  return (
    <div>
      <PageHeader
        title="Announcements"
        description="Shown on the home page and (optionally) the waiting-room display. Author and publish time are recorded by the server."
        actions={
          <Button onClick={() => edit()}>
            <Plus /> New announcement
          </Button>
        }
      />
      {list.isPending ? (
        <PageSpinner />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState title="No announcements" />
      ) : (
        <div className="space-y-3">
          {list.data.map((a) => {
            const expired = a.expires_at && new Date(a.expires_at) < new Date()
            return (
              <Card key={a.id} className="py-4">
                <CardContent className="flex flex-col gap-2 px-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{a.title}</p>
                      <ToneBadge color="blue">{KINDS[a.kind]}</ToneBadge>
                      {a.is_published ? (
                        expired ? (
                          <ToneBadge color="grey">Expired</ToneBadge>
                        ) : (
                          <ToneBadge color="green">Published</ToneBadge>
                        )
                      ) : (
                        <ToneBadge color="grey">Draft</ToneBadge>
                      )}
                      {a.show_on_display && <ToneBadge color="teal">On TV</ToneBadge>}
                    </div>
                    <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">
                      {a.body}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {a.published_at
                        ? `Published ${formatDateTime(a.published_at)}`
                        : `Created ${formatDateTime(a.created_at)}`}
                      {a.expires_at && ` · expires ${formatDateTime(a.expires_at)}`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => edit(a)}>
                      Edit
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Delete"
                      onClick={() => remove.mutate(a.id)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Edit announcement' : 'New announcement'}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="grid gap-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select
                  value={draft.kind}
                  onValueChange={(v) => setDraft({ ...draft, kind: v as AnnouncementKind })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(KINDS).map(([k, label]) => (
                      <SelectItem key={k} value={k}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="an-title">Title</Label>
                <Input
                  id="an-title"
                  maxLength={120}
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="an-body">Message</Label>
                <Textarea
                  id="an-body"
                  rows={4}
                  maxLength={1000}
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="an-exp">Expires (optional)</Label>
                <Input
                  id="an-exp"
                  type="datetime-local"
                  value={draft.expires}
                  onChange={(e) => setDraft({ ...draft, expires: e.target.value })}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={draft.is_published}
                  onCheckedChange={(c) => setDraft({ ...draft, is_published: c })}
                />{' '}
                Published
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={draft.show_on_display}
                  onCheckedChange={(c) => setDraft({ ...draft, show_on_display: c })}
                />{' '}
                Show on waiting-room TV
              </label>
            </div>
          )}
          <DialogFooter>
            <Button
              disabled={
                !draft ||
                draft.title.trim().length < 3 ||
                draft.body.trim().length < 3 ||
                save.isPending
              }
              onClick={() => draft && save.mutate(draft)}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
