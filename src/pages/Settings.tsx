import { useMemo, useState } from 'react'
import { Archive, Database, KeyRound, Plus, Server, ShieldAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Modal } from '@/components/ui/modal'
import { ProviderForm, type ProviderDraft } from '@/components/settings/ProviderForm'
import { ProviderCard } from '@/components/settings/ProviderCard'
import { PROVIDER_KIND_LABEL } from '@/components/settings/PROVIDER_PRESETS'
import { BackupRestore } from '@/components/settings/BackupRestore'
import { DerivedModel } from '@/components/settings/DerivedModels'
import { useSettingsStore } from '@/store/settings'
import { wipeAll } from '@/core/storage/db'
import type { Provider, ProviderKind } from '@/types/domain'

/** 没有任何 provider 时显示给用户的占位文案，按类型给出"何时会用到"。 */
const KIND_EMPTY_HINT: Record<ProviderKind, string> = {
  llm: '必须配置 · 用于小说创作、角色卡、剧情方案与分镜。',
  text2image:
    '可选 · v0.2 用 — 把每个分镜的 image_prompt 渲染成画面（推荐 nano banana / Flux / SDXL）',
  image2video: '可选 · v0.3 用 — 把分镜图变成 5 秒短片（推荐 Kling / Vidu / Runway / Hailuo）',
  imageEdit: '可选 · v0.3+ 用 — 微调画面细节（如换背景、补元素）',
  tts: '可选 · 已配置百炼生图或视频时自动复用同一 Key 配音，模型在下方选择；也可单独添加百炼或 OpenAI 兼容 Speech 服务。',
}

export function SettingsPage() {
  const providers = useSettingsStore((s) => s.providers)
  const addProvider = useSettingsStore((s) => s.addProvider)
  const updateProvider = useSettingsStore((s) => s.updateProvider)
  const resetSettings = useSettingsStore((s) => s.resetAll)

  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Provider | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  const grouped = useMemo(() => {
    const byKind: Record<ProviderKind, Provider[]> = {
      llm: [],
      text2image: [],
      image2video: [],
      imageEdit: [],
      tts: [],
    }
    for (const p of providers) byKind[p.kind].push(p)
    return byKind
  }, [providers])

  const handleCreate = (draft: ProviderDraft) => {
    addProvider(draft)
    setCreating(false)
  }

  const handleUpdate = (draft: ProviderDraft) => {
    if (!editing) return
    updateProvider(editing.id, draft)
    setEditing(null)
  }

  const handleReset = async () => {
    resetSettings()
    await wipeAll()
    setConfirmReset(false)
  }

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-12 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">设置</h1>
        <p className="mt-1 text-sm text-muted">
          项目与素材保存在本机。当前浏览器不支持数据库时会使用本地文件存储；生成请求发送到你配置的模型服务。
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-4 w-4 text-accent" />
                AI 服务商
              </CardTitle>
              <CardDescription>
                配置任何兼容 OpenAI Chat / Images 协议的 endpoint。每种类型可以
                配多个，分别"激活"其中一个用于工作流。
              </CardDescription>
            </div>
            <Button onClick={() => setCreating(true)} className="gap-1.5">
              <Plus className="h-4 w-4" /> 添加
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {(Object.keys(PROVIDER_KIND_LABEL) as ProviderKind[]).map((kind) => {
            const list = grouped[kind]
            return (
              <div key={kind}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {PROVIDER_KIND_LABEL[kind]}
                  </span>
                  <Badge variant="muted">{list.length}</Badge>
                </div>
                {list.length === 0 ? (
                  <p className="text-sm text-muted">{KIND_EMPTY_HINT[kind]}</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {list.map((p) => (
                      <ProviderCard key={p.id} provider={p} onEdit={() => setEditing(p)} />
                    ))}
                  </div>
                )}
                <DerivedModel kind={kind} />
              </div>
            )
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Archive className="h-4 w-4 text-accent" />
            备份与恢复
          </CardTitle>
          <CardDescription>
            把所有项目 / 分镜 / 角色 / 素材 / 资源打包成单个 JSON 文件，方便跨浏览器迁移 或
            versioned snapshot。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BackupRestore />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-accent" />
            数据与隐私
          </CardTitle>
          <CardDescription>
            API Key 存在 localStorage（仅本机）。项目 / 角色 / 分镜 / 资源等存在
            IndexedDB 或本机 local-data 目录。下面这块一旦清空就找不回来了 —— 建议先用「导出全部」备份。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background-soft-2/60 p-3">
            <Database className="h-4 w-4 text-muted" />
            <span className="text-sm text-muted">
              数据库名：<code className="text-foreground/80">dramai</code> · localStorage 键：
              <code className="text-foreground/80">dramai-settings</code>
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="destructive" onClick={() => setConfirmReset(true)} className="gap-1.5">
              <ShieldAlert className="h-4 w-4" /> 清空全部本地数据
            </Button>
          </div>
        </CardContent>
      </Card>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="添加 AI 服务商"
        description="所有字段都只保存在你的浏览器里。"
        className="max-w-lg"
        footer={<>
          <Button variant="ghost" onClick={() => setCreating(false)}>取消</Button>
          <Button type="submit" form="create-provider-form">添加</Button>
        </>}
      >
        <ProviderForm
          formId="create-provider-form"
          onCancel={() => setCreating(false)}
          onSubmit={handleCreate}
          submitLabel="添加"
        />
      </Modal>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="编辑服务商"
        className="max-w-lg"
        footer={<>
          <Button variant="ghost" onClick={() => setEditing(null)}>取消</Button>
          <Button type="submit" form="edit-provider-form">保存</Button>
        </>}
      >
        {editing && (
          <ProviderForm
            formId="edit-provider-form"
            initial={editing}
            onCancel={() => setEditing(null)}
            onSubmit={handleUpdate}
            submitLabel="保存"
          />
        )}
      </Modal>

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="确认清空全部数据？"
        description="包含所有项目、角色、分镜、资源、Provider 配置。这个操作不可恢复。"
        dismissOnBackdrop={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>
              再想想
            </Button>
            <Button variant="destructive" onClick={handleReset}>
              是的，全部清空
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          建议先在「项目」页面把要保留的项目导出 JSON（v0.1 后续提供）。
        </p>
      </Modal>
    </section>
  )
}
