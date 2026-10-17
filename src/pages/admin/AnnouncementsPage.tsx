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
import { defineMessages, useT } from '@/i18n'
import { common } from '@/i18n/common'
import { errorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import type { Announcement, AnnouncementKind } from '@/types/database'

const messages = defineMessages({
  en: {
    'kind.GENERAL': 'General',
    'kind.DOCTOR_DELAY': 'Doctor delay',
    'kind.OPD_CANCELLED': 'OPD cancelled',
    'kind.HOLIDAY': 'Holiday',
    'kind.SCHEDULE_CHANGE': 'Schedule change',
    saved: 'Announcement saved',
    title: 'Announcements',
    description:
      'Shown on the home page and (optionally) the waiting-room display. Author and publish time are recorded by the server.',
    newAnnouncement: 'New announcement',
    editAnnouncement: 'Edit announcement',
    empty: 'No announcements',
    expired: 'Expired',
    published: 'Published',
    draft: 'Draft',
    onTv: 'On TV',
    publishedAt: 'Published {time}',
    createdAt: 'Created {time}',
    expiresAt: 'expires {time}',
    edit: 'Edit',
    delete: 'Delete',
    type: 'Type',
    titleLabel: 'Title',
    message: 'Message',
    expires: 'Expires (optional)',
    showOnTv: 'Show on waiting-room TV',
  },
  hi: {
    'kind.GENERAL': 'सामान्य',
    'kind.DOCTOR_DELAY': 'डॉक्टर की देरी',
    'kind.OPD_CANCELLED': 'ओपीडी रद्द',
    'kind.HOLIDAY': 'छुट्टी',
    'kind.SCHEDULE_CHANGE': 'समय-सारणी में बदलाव',
    saved: 'सूचना सहेजी गई',
    title: 'सूचनाएँ',
    description:
      'होम पेज पर और (चाहें तो) प्रतीक्षा कक्ष के डिस्प्ले पर दिखती हैं। लेखक और प्रकाशन का समय सर्वर दर्ज करता है।',
    newAnnouncement: 'नई सूचना',
    editAnnouncement: 'सूचना बदलें',
    empty: 'कोई सूचना नहीं',
    expired: 'समय समाप्त',
    published: 'प्रकाशित',
    draft: 'ड्राफ़्ट',
    onTv: 'टीवी पर',
    publishedAt: '{time} को प्रकाशित',
    createdAt: '{time} को बनाई गई',
    expiresAt: 'समाप्ति: {time}',
    edit: 'बदलें',
    delete: 'हटाएँ',
    type: 'प्रकार',
    titleLabel: 'शीर्षक',
    message: 'संदेश',
    expires: 'समाप्ति (वैकल्पिक)',
    showOnTv: 'प्रतीक्षा कक्ष के टीवी पर दिखाएँ',
  },
})

const KINDS: AnnouncementKind[] = [
  'GENERAL',
  'DOCTOR_DELAY',
  'OPD_CANCELLED',
  'HOLIDAY',
  'SCHEDULE_CHANGE',
]

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
  const t = useT(messages)
  const c = useT(common)
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
      toast.success(t('saved'))
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
        title={t('title')}
        description={t('description')}
        actions={
          <Button onClick={() => edit()}>
            <Plus /> {t('newAnnouncement')}
          </Button>
        }
      />
      {list.isPending ? (
        <PageSpinner />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState title={t('empty')} />
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
                      <ToneBadge color="blue">{t(`kind.${a.kind}`)}</ToneBadge>
                      {a.is_published ? (
                        expired ? (
                          <ToneBadge color="grey">{t('expired')}</ToneBadge>
                        ) : (
                          <ToneBadge color="green">{t('published')}</ToneBadge>
                        )
                      ) : (
                        <ToneBadge color="grey">{t('draft')}</ToneBadge>
                      )}
                      {a.show_on_display && <ToneBadge color="teal">{t('onTv')}</ToneBadge>}
                    </div>
                    <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">
                      {a.body}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {a.published_at
                        ? t('publishedAt', { time: formatDateTime(a.published_at) })
                        : t('createdAt', { time: formatDateTime(a.created_at) })}
                      {a.expires_at &&
                        ` · ${t('expiresAt', { time: formatDateTime(a.expires_at) })}`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => edit(a)}>
                      {t('edit')}
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('delete')}
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
            <DialogTitle>{draft?.id ? t('editAnnouncement') : t('newAnnouncement')}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="grid gap-3">
              <div className="space-y-1.5">
                <Label>{t('type')}</Label>
                <Select
                  value={draft.kind}
                  onValueChange={(v) => setDraft({ ...draft, kind: v as AnnouncementKind })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {t(`kind.${k}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="an-title">{t('titleLabel')}</Label>
                <Input
                  id="an-title"
                  maxLength={120}
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="an-body">{t('message')}</Label>
                <Textarea
                  id="an-body"
                  rows={4}
                  maxLength={1000}
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="an-exp">{t('expires')}</Label>
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
                  onCheckedChange={(on) => setDraft({ ...draft, is_published: on })}
                />{' '}
                {t('published')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={draft.show_on_display}
                  onCheckedChange={(on) => setDraft({ ...draft, show_on_display: on })}
                />{' '}
                {t('showOnTv')}
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
              {c('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
