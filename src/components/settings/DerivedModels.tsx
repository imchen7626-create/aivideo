import { useState } from 'react'
import { useSettingsStore, type ModelSettings } from '@/store/settings'
import { TTS_MODELS, modelFits } from '@/core/pipeline/presets'
import type { ProviderKind } from '@/types/domain'

const field = 'rounded-lg border border-border bg-background-soft px-3 py-2 text-sm'

const ROWS: Partial<Record<ProviderKind, { key: keyof ModelSettings; title: string; hint: string; options: { id: string; label: string }[] }>> = {
  text2image: {
    key: 'reference',
    title: '角色一致性出图模型',
    hint: '定妆照、场景定场图和每镜参考图出图，复用上面百炼图像服务的 Key。',
    options: [
      { id: 'qwen-image-2.0', label: 'qwen-image-2.0（推荐）' },
      { id: 'qwen-image-edit-plus', label: 'qwen-image-edit-plus' },
    ],
  },
  image2video: {
    key: 'lipSync',
    title: '口型同步视频模型',
    hint: '角色说台词的镜头用配音驱动嘴型，需模型支持音频输入；复用上面百炼视频服务的 Key，失败时自动回退普通视频模型。',
    options: [
      { id: 'wan2.6-i2v-flash', label: 'wan2.6-i2v-flash（性价比高）' },
      { id: 'wan2.7-i2v', label: 'wan2.7-i2v（按整秒生成；实测运镜时易丢人物）' },
      { id: 'wan2.6-i2v', label: 'wan2.6-i2v（画质更好，实测推荐）' },
      { id: 'wan2.5-i2v-preview', label: 'wan2.5-i2v-preview' },
    ],
  },
  tts: {
    key: 'tts',
    title: '配音模型（自动复用百炼 Key 时）',
    hint: '未单独添加语音服务时使用；在这里单独添加了语音服务后，以该服务自己的模型为准。',
    options: TTS_MODELS,
  },
}

/** 设置页里由主服务派生的专用模型：和对应服务放在一起统一管理。 */
export function DerivedModel({ kind }: { kind: ProviderKind }) {
  const row = ROWS[kind]
  const value = useSettingsStore((s) => (row ? s.models[row.key] : ''))
  const setModels = useSettingsStore((s) => s.setModels)
  const [custom, setCustom] = useState('')
  if (!row) return null
  const known = row.options.some((o) => o.id === value)
  return (
    <div className="mt-2 rounded-lg border border-dashed border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{row.title}</span>
        <select
          aria-label={row.title}
          className={field}
          value={known ? value : 'custom'}
          onChange={(e) => {
            if (e.target.value === 'custom') setCustom(value)
            else setModels({ [row.key]: e.target.value })
          }}
        >
          {row.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
          <option value="custom">自定义模型 ID…</option>
        </select>
        {(!known || custom) && (
          <input
            aria-label={row.title + '（自定义）'}
            className={field + ' w-56'}
            value={custom || value}
            placeholder="填写百炼模型 ID"
            onChange={(e) => setCustom(e.target.value)}
            onBlur={() => {
              if (custom.trim()) setModels({ [row.key]: custom.trim() })
              setCustom('')
            }}
          />
        )}
      </div>
      <p className="mt-1 text-xs text-muted">{row.hint}</p>
      {!modelFits(row.key, value) && (
        <p className="mt-1 text-xs text-amber-300">「{value}」看起来不是这一项该用的模型，生成时会被拦下。</p>
      )}
    </div>
  )
}
