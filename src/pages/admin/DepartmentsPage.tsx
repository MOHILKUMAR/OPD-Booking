import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { fetchAllDepartments, saveDepartment } from '@/api/admin'
import { ToneBadge } from '@/components/badges'
import { ErrorState, PageHeader, PageSpinner } from '@/components/states'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useHospital } from '@/hooks/useHospital'
import { defineMessages, useT } from '@/i18n'
import { common } from '@/i18n/common'
import { errorMessage } from '@/lib/errors'
import type { Department } from '@/types/database'

const messages = defineMessages({
  en: {
    title: 'Departments',
    addDepartment: 'Add department',
    editDepartment: 'Edit department',
    saved: 'Department saved',
    name: 'Name',
    description: 'Description',
    order: 'Order',
    status: 'Status',
    active: 'Active',
    hidden: 'Hidden',
    edit: 'Edit',
    sortOrder: 'Sort order',
    shownToPatients: 'Shown to patients',
  },
  hi: {
    title: 'विभाग',
    addDepartment: 'विभाग जोड़ें',
    editDepartment: 'विभाग बदलें',
    saved: 'विभाग सहेजा गया',
    name: 'नाम',
    description: 'विवरण',
    order: 'क्रम',
    status: 'स्थिति',
    active: 'सक्रिय',
    hidden: 'छिपा हुआ',
    edit: 'बदलें',
    sortOrder: 'दिखाने का क्रम',
    shownToPatients: 'मरीज़ों को दिखाएँ',
  },
})

type Draft = {
  id?: string
  name: string
  description: string
  is_active: boolean
  sort_order: number
}

export default function DepartmentsPage() {
  const { data: hospital } = useHospital()
  const queryClient = useQueryClient()
  const t = useT(messages)
  const c = useT(common)
  const list = useQuery({
    queryKey: ['admin-departments', hospital?.id],
    queryFn: () => fetchAllDepartments(hospital!.id),
    enabled: !!hospital,
  })
  const [draft, setDraft] = useState<Draft | null>(null)

  const save = useMutation({
    mutationFn: (d: Draft) =>
      saveDepartment({
        ...d,
        hospital_id: hospital!.id,
        name: d.name.trim(),
        description: d.description.trim() || null,
      }),
    onSuccess: () => {
      toast.success(t('saved'))
      setDraft(null)
      void queryClient.invalidateQueries({ queryKey: ['admin-departments'] })
      void queryClient.invalidateQueries({ queryKey: ['departments'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const edit = (d?: Department) =>
    setDraft(
      d
        ? {
            id: d.id,
            name: d.name,
            description: d.description ?? '',
            is_active: d.is_active,
            sort_order: d.sort_order,
          }
        : { name: '', description: '', is_active: true, sort_order: (list.data?.length ?? 0) + 1 },
    )

  return (
    <div>
      <PageHeader
        title={t('title')}
        actions={
          <Button onClick={() => edit()}>
            <Plus /> {t('addDepartment')}
          </Button>
        }
      />
      {list.isPending ? (
        <PageSpinner />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('name')}</TableHead>
                <TableHead>{t('description')}</TableHead>
                <TableHead>{t('order')}</TableHead>
                <TableHead>{t('status')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.name}</TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground">
                    {d.description}
                  </TableCell>
                  <TableCell>{d.sort_order}</TableCell>
                  <TableCell>
                    {d.is_active ? (
                      <ToneBadge color="green">{t('active')}</ToneBadge>
                    ) : (
                      <ToneBadge color="grey">{t('hidden')}</ToneBadge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => edit(d)}>
                      {t('edit')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? t('editDepartment') : t('addDepartment')}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="grid gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="dep-name">{t('name')}</Label>
                <Input
                  id="dep-name"
                  value={draft.name}
                  maxLength={80}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dep-desc">{t('description')}</Label>
                <Textarea
                  id="dep-desc"
                  value={draft.description}
                  maxLength={500}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dep-order">{t('sortOrder')}</Label>
                <Input
                  id="dep-order"
                  type="number"
                  value={draft.sort_order}
                  onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) || 0 })}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={draft.is_active}
                  onCheckedChange={(on) => setDraft({ ...draft, is_active: on })}
                />{' '}
                {t('shownToPatients')}
              </label>
            </div>
          )}
          <DialogFooter>
            <Button
              disabled={!draft || draft.name.trim().length < 2 || save.isPending}
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
