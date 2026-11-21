import { useState, useEffect } from 'react'
import { X, Copy, Check, Plus, Loader, Trash2, Plug, ExternalLink } from 'lucide-react'
import { mcp, API_BASE } from '../api'
import { useT } from '../i18n'

interface Props {
  onClose: () => void
}

// 时间展示：UTC 字符串（SQLite datetime('now')）转本地时间
function formatDateTime(s?: string, withTime = true) {
  if (!s) return '—'
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z')
  if (isNaN(d.getTime())) return s
  return d.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : {}),
  })
}

export default function McpModal({ onClose }: Props) {
  const t = useT()
  const [tokens, setTokens] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [newToken, setNewToken] = useState('') // 明文令牌：仅创建后展示一次
  const [copied, setCopied] = useState('')
  const [error, setError] = useState('')
  const [confirmId, setConfirmId] = useState('')

  const endpoint = `${API_BASE}/api/mcp`

  const loadTokens = async () => {
    try {
      setTokens(await mcp.tokens())
    } catch (e: any) {
      setError(e.message || '')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadTokens() }, [])

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(key)
    setTimeout(() => setCopied(''), 1500)
  }

  const handleCreate = async () => {
    if (!name.trim() || creating) return
    setCreating(true)
    setError('')
    try {
      const res = await mcp.createToken(name.trim())
      setNewToken(res.token)
      setName('')
      await loadTokens()
    } catch (e: any) {
      setError(e.message || t('操作失败，请重试'))
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    setConfirmId('')
    try {
      await mcp.deleteToken(id)
      setTokens(list => list.filter(x => x.id !== id))
    } catch (e: any) {
      setError(e.message || t('删除失败'))
    }
  }

  const configTemplate = `{
  "mcpServers": {
    "linkpad": {
      "type": "http",
      "url": "${endpoint}",
      "headers": {
        "Authorization": "Bearer <${t('你的令牌')}>"
      }
    }
  }
}`

  // 创建令牌后展示一次的完整配置：占位符替换为明文令牌
  const tokenConfig = newToken ? configTemplate.replace(`<${t('你的令牌')}>`, newToken) : ''

  const suggestedPrompts = [
    t('「查一下我创建的仓库都有哪些」'),
    t('「在我的 XX 仓库里添加一个链接：https://github.com」'),
    t('「把仓库里 XX 这条链接的地址改成 https://example.com」'),
    t('「给 XX 仓库创建一个「AI 工具」分类，再查询它的分类数据」'),
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] overflow-y-auto p-6 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
        {/* 标题 */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
              <Plug className="w-5 h-5 text-gray-400 shrink-0" /> {t('MCP 接入')}
            </h3>
            <p className="text-xs text-gray-400 mt-1">{t('让 Claude Desktop、Cursor 等智能体用你的账号管理 LinkPad')}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        {/* MCP 端点 */}
        <div className="mb-5">
          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">{t('MCP 端点（Streamable HTTP）')}</h4>
          <div className="flex items-center gap-2">
            <input readOnly value={endpoint} onFocus={e => e.target.select()}
              className="flex-1 h-10 px-3 bg-gray-100/80 border border-gray-200 rounded-xl text-sm text-gray-700 font-mono focus:outline-none" />
            <button onClick={() => copy(endpoint, 'endpoint')}
              className="h-10 w-10 shrink-0 rounded-xl bg-gray-100 hover:bg-gray-200 border border-gray-200 flex items-center justify-center text-gray-500 transition-all">
              {copied === 'endpoint' ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1.5">{t('把端点和下方令牌配置到任意支持 MCP 的客户端即可使用')}</p>
        </div>

        {/* 配置示例 */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide">{t('配置示例（Claude Desktop / Cursor）')}</h4>
            <button onClick={() => copy(configTemplate, 'template')}
              className="text-xs text-blue-500 hover:text-blue-600 font-medium flex items-center gap-1">
              {copied === 'template' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {t('复制模板')}
            </button>
          </div>
          <pre className="bg-gray-100/80 border border-gray-200 rounded-xl p-4 text-[13px] leading-relaxed font-mono text-gray-700 overflow-x-auto whitespace-pre">{configTemplate}</pre>
          <p className="text-xs text-gray-400 mt-1.5">{t('把 <你的令牌> 替换为下方任一令牌后，粘贴到客户端 MCP 配置并重启客户端即可使用')}</p>
        </div>

        {/* 接入令牌 */}
        <div className="mb-5">
          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">{t('接入令牌')}</h4>
          <div className="flex items-center gap-2">
            <input value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
              maxLength={50}
              placeholder={t('令牌名称（必填，如 claude-desktop）')}
              className="flex-1 h-11 px-4 bg-gray-100/80 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400/50" />
            <button onClick={handleCreate} disabled={!name.trim() || creating}
              className="h-11 px-4 shrink-0 rounded-xl bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white text-sm font-medium flex items-center gap-1.5 transition-all">
              {creating ? <Loader className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} {t('创建令牌')}
            </button>
          </div>
          {newToken && (
            <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 p-4">
              <p className="text-xs text-amber-600 font-medium mb-2">{t('请立即复制保存完整配置，此内容仅展示一次')}</p>
              <div className="relative bg-white/90 border border-amber-200 rounded-xl p-3 pr-12">
                <pre className="text-[12px] leading-relaxed font-mono text-amber-800 overflow-x-auto whitespace-pre">{tokenConfig}</pre>
                <button onClick={() => copy(tokenConfig, 'tokenconfig')} title={t('复制完整配置')}
                  className="absolute top-2.5 right-2.5 h-8 w-8 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 hover:bg-amber-100 transition-all">
                  {copied === 'tokenconfig' ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 text-[12px] font-mono text-amber-700 break-all select-all">{newToken}</code>
                <button onClick={() => copy(newToken, 'newtoken')}
                  className="h-8 px-2.5 shrink-0 rounded-lg bg-white/80 border border-amber-200 flex items-center gap-1 text-xs text-amber-600 hover:bg-amber-100 transition-all">
                  {copied === 'newtoken' ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />} {t('复制令牌')}
                </button>
              </div>
              <button onClick={() => setNewToken('')} className="mt-2.5 text-xs text-amber-600/80 hover:text-amber-700">{t('我已保存，关闭提示')}</button>
            </div>
          )}
          {error && <p className="text-xs text-red-500 mt-2">{error}</p>}

          {/* 令牌表格 */}
          <div className="mt-3 rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-100/80 text-gray-500">
                  <th className="px-3 py-2 text-left font-medium">{t('名称')}</th>
                  <th className="px-3 py-2 text-left font-medium">{t('令牌')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('调用次数')}</th>
                  <th className="px-3 py-2 text-left font-medium hidden sm:table-cell">{t('最近使用')}</th>
                  <th className="px-3 py-2 text-left font-medium hidden sm:table-cell">{t('创建时间')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('操作')}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">{t('加载中...')}</td></tr>
                ) : tokens.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">{t('暂无令牌，创建一个开始使用')}</td></tr>
                ) : tokens.map((tk: any) => (
                  <tr key={tk.id} className="border-t border-gray-100 text-gray-700">
                    <td className="px-3 py-2.5 font-medium text-gray-800 max-w-[120px] truncate">{tk.name}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-gray-500">{tk.token_preview}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{tk.use_count ?? 0}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-500 hidden sm:table-cell">{tk.last_used_at ? formatDateTime(tk.last_used_at) : '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-500 hidden sm:table-cell">{formatDateTime(tk.created_at, false)}</td>
                    <td className="px-3 py-2.5 text-right">
                      {confirmId === tk.id ? (
                        <span className="inline-flex items-center gap-2">
                          <button onClick={() => handleDelete(tk.id)} className="text-xs text-red-500 hover:text-red-600 font-medium">{t('确认')}</button>
                          <button onClick={() => setConfirmId('')} className="text-xs text-gray-400 hover:text-gray-600">{t('取消')}</button>
                        </span>
                      ) : (
                        <button onClick={() => setConfirmId(tk.id)} className="inline-flex items-center gap-1 text-xs text-red-400 hover:text-red-500 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" /> {t('删除')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 推荐提示词 */}
        <div>
          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">{t('推荐提示词（连接成功后验证）')}</h4>
          <ol className="rounded-xl bg-gray-100/80 border border-gray-200 p-4 text-sm text-gray-700 space-y-1.5 list-decimal list-inside">
            {suggestedPrompts.map((p, i) => <li key={i}>{p}</li>)}
          </ol>
          <p className="text-xs text-gray-400 mt-2 flex items-center gap-1">
            <ExternalLink className="w-3.5 h-3.5" />
            {t('支持工具：首页数据、仓库 / 分类 / 链接查询、添加链接、编辑链接、创建分类')}
          </p>
        </div>
      </div>
    </div>
  )
}
