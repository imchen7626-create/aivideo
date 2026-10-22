import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import type { ActiveProviderMap, Provider, ProviderKind } from '@/types/domain'
import { normalizeBaseUrl } from '@/core/aliyun-workspace'

/** 由主服务派生调用的专用模型（与图生视频等服务统一在设置页管理）。 */
export interface ModelSettings {
  /** 复用百炼 Key 时的配音模型；'auto' = 情感配音优先，不支持时回退 qwen3-tts-flash。 */
  tts: string
  /** 角色一致性（定妆照/参考图出图）模型。 */
  reference: string
  /** 口型同步（音频驱动）视频模型。 */
  lipSync: string
}
export const DEFAULT_MODELS: ModelSettings = {
  tts: 'auto',
  reference: 'qwen-image-2.0',
  lipSync: 'wan2.6-i2v-flash',
}
/** 1.6.0 之前这些模型写在生产预设里，升级时搬到设置。 */
function legacyModels(): Partial<ModelSettings> {
  try {
    const old = JSON.parse(localStorage.getItem('studio-preset') ?? '{}') as Record<string, unknown>
    const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
    return Object.fromEntries(
      Object.entries({ tts: pick(old.ttsModel), reference: pick(old.referenceModel), lipSync: pick(old.lipSyncModel) }).filter(
        ([, v]) => v,
      ),
    )
  } catch {
    return {}
  }
}

interface SettingsState {
  providers: Provider[]
  activeProviderIds: ActiveProviderMap
  models: ModelSettings
  setModels: (patch: Partial<ModelSettings>) => void

  addProvider: (input: Omit<Provider, 'id'>) => Provider
  updateProvider: (id: string, patch: Partial<Omit<Provider, 'id'>>) => void
  removeProvider: (id: string) => void
  setActiveProvider: (kind: ProviderKind, id: string | undefined) => void
  resetAll: () => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      providers: [],
      activeProviderIds: {},
      models: { ...DEFAULT_MODELS },

      setModels: (patch) =>
        set((state) => {
          const next = { ...state.models }
          for (const [k, v] of Object.entries(patch) as [keyof ModelSettings, string | undefined][])
            next[k] = v?.trim() || DEFAULT_MODELS[k]
          return { models: next }
        }),

      addProvider: (input) => {
        const provider: Provider = { id: nanoid(10), ...input, baseUrl: normalizeBaseUrl(input.baseUrl) }
        set((state) => {
          // 该 kind 下还没有激活项时，新建的自动激活
          const activeProviderIds = { ...state.activeProviderIds }
          if (!activeProviderIds[provider.kind]) {
            activeProviderIds[provider.kind] = provider.id
          }
          return {
            providers: [...state.providers, provider],
            activeProviderIds,
          }
        })
        return provider
      },

      updateProvider: (id, patch) => {
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === id
              ? { ...p, ...patch, ...(patch.baseUrl !== undefined ? { baseUrl: normalizeBaseUrl(patch.baseUrl) } : {}) }
              : p,
          ),
        }))
      },

      removeProvider: (id) => {
        set((state) => {
          const activeProviderIds = { ...state.activeProviderIds }
          for (const key of Object.keys(activeProviderIds) as ProviderKind[]) {
            if (activeProviderIds[key] === id) {
              delete activeProviderIds[key]
            }
          }
          return {
            providers: state.providers.filter((p) => p.id !== id),
            activeProviderIds,
          }
        })
      },

      setActiveProvider: (kind, id) => {
        set((state) => {
          const activeProviderIds = { ...state.activeProviderIds }
          if (id) {
            activeProviderIds[kind] = id
          } else {
            delete activeProviderIds[kind]
          }
          return { activeProviderIds }
        })
      },

      resetAll: () => set({ providers: [], activeProviderIds: {}, models: { ...DEFAULT_MODELS } }),
    }),
    {
      name: 'dramai-settings',
      version: 3,
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<SettingsState>
        return {
          ...state,
          // 3 之前保存的地址可能缺少 https://，导致工作区地址无法识别、走错接入方式。
          providers: (state.providers ?? []).map((p) => ({ ...p, baseUrl: normalizeBaseUrl(p.baseUrl) })),
          models: { ...DEFAULT_MODELS, ...(version < 2 ? legacyModels() : {}), ...state.models },
        } as SettingsState
      },
    },
  ),
)

/** 取出某个 kind 当前激活的 provider；没有就 undefined。 */
export function useActiveProvider(kind: ProviderKind): Provider | undefined {
  return useSettingsStore((s) => {
    const id = s.activeProviderIds[kind]
    if (!id) return undefined
    return s.providers.find((p) => p.id === id)
  })
}
