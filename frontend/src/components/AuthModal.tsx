import { useEffect, useState } from 'react'
import { useAuth } from '../AuthContext'
import { auth as authApi, API_BASE } from '../api'
import { useT } from '../i18n'
import { Mail, Lock, Eye, EyeOff, X, ShieldCheck, KeyRound } from 'lucide-react'

// Google 四色 "G" 图标
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.5 6.1 29.5 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.7-.4-3.9z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.7l6.2 5.2C36.9 40.2 44 35 44 24c0-1.3-.1-2.7-.4-3.9z" />
    </svg>
  )
}

interface Props {
  onClose: () => void
  initialTab?: 'login' | 'register'
  initialError?: string
}

export default function AuthModal({ onClose, initialTab = 'login', initialError }: Props) {
  const t = useT()
  const { login, register } = useAuth()
  const [tab, setTab] = useState<'login' | 'register' | 'reset'>(initialTab)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)
  const [error, setError] = useState(initialError || '')
  const [successMsg, setSuccessMsg] = useState('')
  const [loading, setLoading] = useState(false)

  // 重置密码流程
  const [resetStep, setResetStep] = useState<1 | 2>(1)
  const [resetCode, setResetCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [showNewPw, setShowNewPw] = useState(false)
  const [countdown, setCountdown] = useState(0)

  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  const switchTab = (t: 'login' | 'register' | 'reset') => {
    setTab(t)
    setError('')
    setSuccessMsg('')
    setResetStep(1)
    setResetCode('')
    setNewPassword('')
  }

  const handleSendCode = async (silent = false) => {
    setError('')
    if (!emailRegex.test(email)) { setError(t('请输入正确的邮箱格式')); return }
    setLoading(true)
    try {
      await authApi.sendResetCode(email)
      if (!silent) setSuccessMsg(t('验证码已发送，请查收邮箱（注意垃圾箱）'))
      setResetStep(2)
      setCountdown(60)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleResetPassword = async () => {
    setError('')
    if (resetCode.trim().length !== 6) return setError(t('请输入 6 位验证码'))
    if (newPassword.length < 6) return setError(t('密码至少 6 位'))
    setLoading(true)
    try {
      await authApi.resetPassword({ email, code: resetCode.trim(), password: newPassword })
      setResetStep(1)
      setResetCode('')
      setNewPassword('')
      setPassword('')
      setCountdown(0)
      setSuccessMsg(t('密码已重置，请使用新密码登录'))
      setTab('login')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (tab === 'reset') {
      if (resetStep === 1) return handleSendCode()
      return handleResetPassword()
    }

    if (!emailRegex.test(email)) return setError(t('请输入正确的邮箱格式'))
    if (password.length < 6) return setError(t('密码至少 6 位'))

    if (tab === 'register') {
      if (password !== confirmPassword) return setError(t('两次密码不一致'))
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
      <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl w-full max-w-md md:max-w-[760px] lg:max-w-[860px] mx-4 flex overflow-hidden">
        {/* 左侧插图 — 桌面端显示，登录/注册共用；lg 下宽 440 接近图片 3:4 原比例，基本无裁切 */}
        <div className="hidden md:block w-[300px] lg:w-[440px] flex-shrink-0 relative">
          <img src="/auth-side.jpg" alt="" className="w-full h-full object-cover" />
          {/* slogan 叠加在插图底部 */}
          <div className="absolute inset-x-0 bottom-0 pt-16 pb-7 px-6 text-center bg-gradient-to-t from-indigo-600/70 via-indigo-500/30 to-transparent">
            <p className="text-white font-bold text-lg">{t('收藏好链接，分享好品味')}</p>
          </div>
        </div>

        {/* 右侧表单 — 固定高度保证登录/注册弹窗大小一致，超出部分滚动（隐藏滚动条） */}
        <div className="relative flex-1 min-w-0 p-8 h-[600px] max-h-[85vh] overflow-y-auto no-scrollbar">
          <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>

          <div className="flex flex-col items-center mb-5">
            {tab === 'reset' ? (
              <div className="w-28 h-28 rounded-3xl bg-blue-50 flex items-center justify-center">
                <KeyRound className="w-12 h-12 text-blue-500" />
              </div>
            ) : (
              <img src="/logo.png" alt="LinkPad" className="w-28 h-28 rounded-3xl object-contain" />
            )}
            <h2 className="text-2xl font-bold text-gray-800 mt-3">
              {tab === 'login' ? t('欢迎回来') : tab === 'register' ? t('创建新账号') : t('重置密码')}
            </h2>
            {tab === 'reset' && (
              <p className="text-sm text-gray-400 mt-1">
                {resetStep === 1 ? t('输入注册邮箱，我们将发送验证码') : t('验证码已发送至 {email}', { email })}
              </p>
            )}
          </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {tab === 'reset' && resetStep === 2 && (
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="email" value={email} disabled
                className="w-full h-12 pl-12 pr-4 bg-gray-100/70 border border-white/80 rounded-2xl text-gray-400 text-sm"
              />
            </div>
          )}

          {tab === 'reset' && resetStep === 2 && (
            <div className="relative">
              <ShieldCheck className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text" placeholder={t('邮箱验证码')} value={resetCode} maxLength={6}
                onChange={e => setResetCode(e.target.value.replace(/\D/g, ''))}
                className="w-full h-12 pl-12 pr-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 placeholder-gray-400 tracking-widest"
              />
            </div>
          )}

          {!(tab === 'reset' && resetStep === 2) && (
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="email" placeholder={t('邮箱')} value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full h-12 pl-12 pr-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 placeholder-gray-400"
              />
            </div>
          )}

          {!(tab === 'reset' && resetStep === 1) && (
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type={tab === 'reset' ? (showNewPw ? 'text' : 'password') : (showPw ? 'text' : 'password')}
                placeholder={tab === 'reset' ? t('新密码') : t('密码')}
                value={tab === 'reset' ? newPassword : password}
                onChange={e => tab === 'reset' ? setNewPassword(e.target.value) : setPassword(e.target.value)}
                className="w-full h-12 pl-12 pr-12 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 placeholder-gray-400"
              />
              <button
                type="button"
                onClick={() => tab === 'reset' ? setShowNewPw(!showNewPw) : setShowPw(!showPw)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {tab === 'reset' ? (showNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />) : (showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />)}
              </button>
            </div>
          )}

          {tab === 'register' && (
            <>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type={showConfirmPw ? 'text' : 'password'} placeholder={t('确认密码')} value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="w-full h-12 pl-12 pr-12 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 placeholder-gray-400"
                />
                <button type="button" onClick={() => setShowConfirmPw(!showConfirmPw)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showConfirmPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <div className="relative">
                <input
                  type="text" placeholder={t('昵称（选填）')} value={nickname}
                  onChange={e => setNickname(e.target.value)}
                  className="w-full h-12 pl-4 pr-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800 placeholder-gray-400"
                />
              </div>
            </>
          )}

          {error && <p className="text-red-500 text-sm text-center">{error}</p>}
          {successMsg && <p className="text-green-600 text-sm text-center">{successMsg}</p>}

          <button
            type="submit" disabled={loading}
            className="w-full h-12 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-2xl transition-colors disabled:opacity-50"
          >
            {loading ? t('处理中...')
              : tab === 'login' ? t('登录')
              : tab === 'register' ? t('注册')
              : resetStep === 1 ? t('发送验证码') : t('重置密码')}
          </button>

          {tab === 'reset' && resetStep === 2 && (
            <p className="text-sm text-center">
              {t('没收到验证码？')}
              {countdown > 0 ? (
                <span className="text-gray-400">{t('{countdown}s 后可重新发送', { countdown })}</span>
              ) : (
                <button type="button" onClick={() => handleSendCode(true)} className="text-blue-500 hover:text-blue-600 font-medium">{t('重新发送')}</button>
              )}
            </p>
          )}

          {tab === 'login' && (
            <p className="text-sm text-right -mt-2">
              <button type="button" onClick={() => switchTab('reset')} className="text-gray-400 hover:text-blue-500">{t('忘记密码？')}</button>
            </p>
          )}

          {tab !== 'reset' && (
            <>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs text-gray-400">{t('或')}</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
              <a
                href={`${API_BASE}/api/auth/google/start`}
                className="w-full h-12 flex items-center justify-center gap-3 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 font-medium rounded-2xl transition-colors"
              >
                <GoogleIcon />
                使用 Google 账号{tab === 'login' ? t('登录') : t('注册')}
              </a>
            </>
          )}
        </form>

        <p className="text-sm text-gray-500 text-center mt-6">
          {tab === 'login' ? (
            <>{t('还没有账号？')}<button onClick={() => switchTab('register')} className="text-blue-500 hover:text-blue-600 font-medium">{t('立即注册')}</button></>
          ) : (
            <>{t('已有账号？')}<button onClick={() => switchTab('login')} className="text-blue-500 hover:text-blue-600 font-medium">{t('返回登录')}</button></>
          )}
        </p>
        </div>
      </div>
    </div>
  )
}
