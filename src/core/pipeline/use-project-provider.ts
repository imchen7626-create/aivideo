import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/core/storage/db'
import { useSettingsStore } from '@/store/settings'
import type { ProviderKind } from '@/types/domain'
export function useProjectProvider(kind: ProviderKind, projectId: string) {
  const selected = useLiveQuery(
    async () => (await db.productions.get(projectId))?.preset?.providers[kind],
    [projectId, kind],
  )
  return useSettingsStore((s) =>
    s.providers.find((p) => p.kind === kind && p.id === (selected || s.activeProviderIds[kind])),
  )
}
