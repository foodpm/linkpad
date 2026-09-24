import { useState } from 'react'
import { useAuth } from '../AuthContext'
import { Mail, Lock, Eye, EyeOff, X } from 'lucide-react'

interface Props {
  onClose: () => void
  initialTab?: 'login' | 'register'
}

export default function AuthModal({ onClose, initialTab = 'login' }: Props) {
  const { login, register } = useAuth()
  const [tab, setTab] = useState<'login' | 'register'>(initialTab)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!emailRegex.test(email)) return setError('请输入正确的邮箱格式')
    if (password.length < 6) return setError('密码至少 6 位')

    if (tab === 'register') {
      if (password !== confirmPassword) return setError('两次密码不一致')
    }

    setLoading(true)
    try {
      if (tab === 'login') {
        await login(email, password)
      } else {
        await register(email, password, nickname || undefined)
      }
      onClose()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white/90 backdrop-blur-xl rounded-3xl border border-white/60 shadow-xl w-full max-w-md md:max-w-[760px] lg:max-w-[860px] mx-4 flex overflow-hidden">
        {/* 左侧插图 — 桌面端显示，登录/注册共用；lg 下宽 440 接近图片 3:4 原比例，基本无裁切 */}
        <div className="hidden md:block w-[300px] lg:w-[440px] flex-shrink-0 relative">
          <img src="/auth-side.jpg" alt="" className="w-full h-full object-cover" />
          {/* slogan 叠加在插图底部 */}
          <div className="absolute inset-x-0 bottom-0 pt-16 pb-7 px-6 text-center bg-gradient-to-t from-indigo-600/70 via-indigo-500/30 to-transparent">
            <p className="text-white font-bold text-lg">收藏好链接，分享好品味</p>
          </div>
        </div>

        {/* 右侧表单 — 固定高度保证登录/注册弹窗大小一致，超出部分滚动（隐藏滚动条） */}
        <div className="relative flex-1 min-w-0 p-8 h-[600px] max-h-[85vh] overflow-y-auto no-scrollbar">
          <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>

          <div className="flex flex-col items-center mb-5">
            <img src="/logo.png" alt="LinkPad" className="w-28 h-28 rounded-3xl object-contain" />
            <h2 className="text-2xl font-bold text-gray-800 mt-3">{tab === 'login' ? '欢迎回来' : '创建新账号'}</h2>
          </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="email" placeholder="邮箱" value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full h-12 pl-12 pr-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 placeholder-gray-400"
            />
          </div>

          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type={showPw ? 'text' : 'password'} placeholder="密码" value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full h-12 pl-12 pr-12 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 placeholder-gray-400"
            />
            <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {tab === 'register' && (
            <>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type={showConfirmPw ? 'text' : 'password'} placeholder="确认密码" value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="w-full h-12 pl-12 pr-12 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 placeholder-gray-400"
                />
                <button type="button" onClick={() => setShowConfirmPw(!showConfirmPw)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showConfirmPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <div className="relative">
                <input
                  type="text" placeholder="昵称（选填）" value={nickname}
                  onChange={e => setNickname(e.target.value)}
                  className="w-full h-12 pl-4 pr-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 placeholder-gray-400"
                />
              </div>
            </>
          )}

          {error && <p className="text-red-500 text-sm text-center">{error}</p>}

          <button
            type="submit" disabled={loading}
            className="w-full h-12 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-2xl transition-colors disabled:opacity-50"
          >
            {loading ? '处理中...' : tab === 'login' ? '登录' : '注册'}
          </button>
        </form>

        <p className="text-sm text-gray-500 text-center mt-6">
          {tab === 'login' ? (
            <>还没有账号？<button onClick={() => { setTab('register'); setError('') }} className="text-blue-500 hover:text-blue-600 font-medium">立即注册</button></>
          ) : (
            <>已有账号？<button onClick={() => { setTab('login'); setError('') }} className="text-blue-500 hover:text-blue-600 font-medium">返回登录</button></>
          )}
        </p>
        </div>
      </div>
    </div>
  )
}
