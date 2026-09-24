/** 通用骨架屏组件 — 各页面加载时显示与真实布局一致的占位 */

function Bone({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} />
}

/** 首页链接卡片骨架（模仿 HomeToolCard：左侧图标块 + 两行文字） */
function ToolCardSkeleton() {
  return (
    <div className="p-3 rounded-2xl bg-white/70 border border-white/80 ring-1 ring-black/[0.03]">
      <div className="flex items-center gap-3">
        <Bone className="w-9 h-9 rounded-xl flex-shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          <Bone className="h-3 w-3/4" />
          <Bone className="h-2.5 w-1/2" />
        </div>
      </div>
    </div>
  )
}

/** 首页骨架：面板标题 + 工具卡片网格（与 renderHomeContent 一致） */
export function HomeSkeleton() {
  return (
    <>
      {[0, 1].map((panel) => (
        <div key={panel} className="bg-white/60 backdrop-blur-md rounded-3xl border border-white/70 shadow-[0_4px_16px_-6px_rgba(0,0,0,0.06)] p-6 sm:p-8">
          <div className="flex items-center gap-3 mb-6">
            <Bone className="w-1.5 h-5 rounded-full" />
            <Bone className="h-5 w-28" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => <ToolCardSkeleton key={i} />)}
          </div>
        </div>
      ))}
    </>
  )
}

/** 仓库详情页骨架：头部大卡片 + 分组链接网格 */
export function RepoPageSkeleton() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50/80 via-white to-blue-50/80">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <Bone className="h-4 w-16 mb-6" />
        {/* 仓库头部 */}
        <div className="bg-white/60 backdrop-blur-xl rounded-3xl border border-white/70 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.08)] p-6 sm:p-8 mb-8">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6">
            <div className="flex items-start gap-4 sm:gap-5 min-w-0">
              <Bone className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl flex-shrink-0" />
              <div className="min-w-0 flex-1 space-y-3">
                <Bone className="h-7 w-2/5" />
                <Bone className="h-3.5 w-3/5" />
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-2">
                    {[0, 1, 2].map((i) => <Bone key={i} className="w-7 h-7 rounded-full ring-2 ring-gray-200/60" />)}
                  </div>
                  <Bone className="h-3 w-24" />
                  <Bone className="h-3 w-16" />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Bone className="h-9 w-20 rounded-xl" />
              <Bone className="h-9 w-20 rounded-xl" />
            </div>
          </div>
        </div>
        {/* 链接分组 */}
        {[0, 1].map((group) => (
          <div key={group} className="bg-white/60 backdrop-blur-xl rounded-3xl border border-white/70 shadow-[0_4px_16px_-6px_rgba(0,0,0,0.06)] p-6 sm:p-8 mb-6">
            <div className="flex items-center gap-3 mb-6">
              <Bone className="w-1.5 h-5 rounded-full" />
              <Bone className="h-5 w-24" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {Array.from({ length: 8 }).map((_, i) => <ToolCardSkeleton key={i} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 用户主页骨架：个人资料卡 + 仓库列表 */
export function UserPageSkeleton() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-blue-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <Bone className="h-4 w-16 mb-6" />
        {/* 资料卡 */}
        <div className="bg-white/30 backdrop-blur-xl rounded-3xl border border-white/60 p-8 mb-6">
          <div className="flex items-center gap-6">
            <Bone className="w-20 h-20 rounded-3xl flex-shrink-0" />
            <div className="flex-1 space-y-3">
              <Bone className="h-6 w-1/4" />
              <Bone className="h-3.5 w-2/5" />
              <div className="flex gap-6 pt-1">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="space-y-1.5">
                    <Bone className="h-4 w-8" />
                    <Bone className="h-2.5 w-8" />
                  </div>
                ))}
              </div>
            </div>
            <Bone className="h-11 w-24 rounded-2xl flex-shrink-0 hidden sm:block" />
          </div>
        </div>
        {/* 仓库列表 */}
        <div className="bg-white/30 backdrop-blur-xl rounded-3xl border border-white/60 p-6">
          <Bone className="h-5 w-40 mb-4" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white/20 border border-gray-200/40 rounded-2xl p-4">
                <div className="flex items-center gap-3 mb-2">
                  <Bone className="w-9 h-9 rounded-xl flex-shrink-0" />
                  <div className="flex-1 min-w-0 space-y-2">
                    <Bone className="h-3.5 w-2/3" />
                    <Bone className="h-2.5 w-1/2" />
                  </div>
                </div>
                <Bone className="h-2.5 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/** 管理后台骨架：侧边栏 + 顶栏 + 表格 */
export function AdminPageSkeleton() {
  return (
    <div className="min-h-screen bg-[#f5f6f8] flex">
      {/* 侧边栏 */}
      <aside className="hidden lg:block w-56 bg-[#1a1d23] flex-shrink-0">
        <div className="h-16 flex items-center px-5 border-b border-[#2a2d33]">
          <Bone className="h-3.5 w-24" />
        </div>
        <div className="py-3 space-y-1 px-0">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-2.5">
              <Bone className="w-4 h-4" />
              <Bone className="h-3 w-16" />
            </div>
          ))}
        </div>
      </aside>
      {/* 主区 */}
      <main className="flex-1 min-w-0">
        <header className="h-16 bg-white border-b border-[#e5e7eb] flex items-center px-5">
          <Bone className="h-5 w-20" />
        </header>
        <div className="p-6">
          <div className="bg-white rounded-xl border border-[#e5e7eb] p-6">
            <div className="flex items-center justify-between mb-4">
              <Bone className="h-5 w-24" />
              <Bone className="h-9 w-24 rounded-lg" />
            </div>
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 py-2.5">
                  <Bone className="w-8 h-8 rounded-full flex-shrink-0" />
                  <Bone className="h-3.5 w-1/4" />
                  <Bone className="h-3.5 flex-1 max-w-[200px]" />
                  <Bone className="h-3.5 w-20 hidden sm:block" />
                  <Bone className="h-3.5 w-16 hidden md:block" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
