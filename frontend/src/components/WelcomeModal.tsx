import { motion } from 'motion/react'
import { X, LayoutGrid, FolderHeart, CandlestickChart, CheckSquare, Search, Cloud, Download, Chrome } from 'lucide-react'
import { useT } from '../i18n'

interface Props {
  onClose: () => void
  onRegister: () => void
}

const features = [
  { icon: LayoutGrid, title: '极简导航首页', desc: '分类收纳常用链接，拖拽排序、自定义图标、密码保护', color: 'text-blue-500 bg-blue-50' },
  { icon: FolderHeart, title: '链接仓库 & 发现', desc: '创建公开/私密仓库，浏览社区仓库，关注收藏一键同步首页', color: 'text-blue-600 bg-blue-50' },
  { icon: CandlestickChart, title: '股票 · 黄金小组件', desc: '实时行情卡片，自由拖入任意分类，行情自动刷新', color: 'text-amber-500 bg-amber-50' },
  { icon: CheckSquare, title: '待办事项', desc: '内置 Todo 面板，轻松管理每天的任务', color: 'text-emerald-500 bg-emerald-50' },
  { icon: Search, title: '搜索直达', desc: '顶部搜索框，本地工具与网络内容一键切换', color: 'text-sky-500 bg-sky-50' },
  { icon: Cloud, title: '多端同步', desc: '登录后云端同步导航配置，浏览器与网站数据一致', color: 'text-rose-500 bg-rose-50' },
]

export default function WelcomeModal({ onClose, onRegister }: Props) {
  const t = useT()
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-white rounded-3xl border border-white/60 shadow-2xl p-6 sm:p-8 [&::-webkit-scrollbar]:hidden"
      >
        <button onClick={onClose} className="absolute top-4 right-4 w-9 h-9 rounded-2xl bg-white/60 border border-white/80 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-white transition-all">
          <X className="w-4 h-4" />
        </button>

        {/* 网站整体介绍 */}
        <div className="flex flex-col items-center text-center mb-6">
          <img src="/logo.png" alt="LinkPad" className="w-16 h-16 rounded-2xl object-contain mb-3" />
          <h2 className="text-2xl font-bold text-gray-800">{t('欢迎使用 LinkPad')}</h2>
          <p className="text-sm text-gray-500 mt-2 leading-relaxed max-w-md">
            {t('一个集「极简导航首页 + 社区链接仓库」于一体的效率工具，让浏览器新标签页成为你的效率中心。')}
          </p>
        </div>

        {/* 功能特性 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          {features.map(f => (
            <div key={f.title} className="flex items-start gap-3 p-3.5 rounded-2xl bg-white/60 border border-white/80 ring-1 ring-black/[0.03]">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${f.color}`}>
                <f.icon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h4 className="font-semibold text-gray-800 text-sm">{t(f.title)}</h4>
                <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{t(f.desc)}</p>
              </div>
            </div>
          ))}
        </div>

        {/* 插件下载 */}
        <div className="rounded-2xl bg-blue-50 border border-blue-100/60 p-4 mb-6">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500 flex items-center justify-center text-white flex-shrink-0">
              <Download className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-gray-800 text-sm">{t('把 LinkPad 装进你的新标签页')}</h4>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                {t('安装 LinkPad 浏览器扩展（Chrome / Edge），每次打开新标签页都会自动展示你的 LinkPad 首页——常用链接、股票行情、待办事项一目了然，无需再手动打开网站。支持离线缓存，加载更快，数据与网站云端同步。')}
              </p>
              <div className="flex gap-2 mt-3">
                <a href="https://chromewebstore.google.com/detail/linkpad-%E6%96%B0%E6%A0%87%E7%AD%BE%E9%A1%B5/cjpglkdffginlpandblgodncddjidkmd" target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 px-4 h-10 rounded-2xl bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium transition-colors">
                  <Chrome className="w-4 h-4" /> {t('Chrome 商店在线安装')}
                </a>
                <a href="/linkpad-extension.zip" download
                  className="inline-flex items-center justify-center gap-1.5 px-4 h-10 rounded-2xl bg-white/70 border border-white/80 hover:bg-white/90 text-gray-600 text-sm transition-colors">
                  <Download className="w-4 h-4" /> {t('下载离线安装包')}
                </a>
              </div>
              <p className="text-xs text-gray-400 mt-2 leading-relaxed">
                {t('推荐通过谷歌插件商店在线安装；若无法访问谷歌插件商店，可下载离线安装包手动加载。')}
              </p>
            </div>
          </div>
        </div>

        {/* 立即注册 */}
        <button onClick={onRegister}
          className="w-full h-12 rounded-2xl bg-[#3050F0] hover:bg-[#2440d0] text-white font-semibold text-base transition-all shadow-lg shadow-[#3050F0]/20">
          {t('立即注册')}
        </button>
        <p className="text-xs text-gray-400 text-center mt-3">{t('注册后可创建链接仓库、关注社区仓库，配置云端同步')}</p>
      </motion.div>
    </div>
  )
}
