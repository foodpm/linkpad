import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import { users, follows, uploadAvatar, admin } from '../api'
import { X, User, Users, Edit3, LogOut, Camera, Loader, Settings, Download, Mail, Palette, ChevronDown, Image as ImageIcon, Chrome, Globe, Check, Bell } from 'lucide-react'
import { useT, useLang } from '../i18n'

interface Props {
  onClose: () => void
  onOpenPanelStyleModal: () => void
  onOpenWallpaperManager: () => void
  notifications: any[]
  unreadCount: number
  onFetchNotifications: () => void
  onMarkNotificationsRead: () => void
}

export default function UserPanel({ onClose, onOpenPanelStyleModal, onOpenWallpaperManager, notifications, unreadCount, onFetchNotifications, onMarkNotificationsRead }: Props) {
  const t = useT()
  const { lang, setLang } = useLang()
  const { user, logout, refreshUser } = useAuth()
  const navigate = useNavigate()
  const [profile, setProfile] = useState<any>(null)
  const [isAdminUser, setIsAdminUser] = useState(false)
  const [editing, setEditing] = useState(false)
  const [nickname, setNickname] = useState('')
  const [showFollowers, setShowFollowers] = useState(false)
  const [followers, setFollowers] = useState<any[]>([])
  const [following, setFollowing] = useState<any[]>([])
  const [viewMode, setViewMode] = useState<'followers' | 'following'>('followers')
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarPreview, setAvatarPreview] = useState('')
  const [showExtSettings, setShowExtSettings] = useState(false)
  const [showLangSettings, setShowLangSettings] = useState(false)
  const [showNotifSettings, setShowNotifSettings] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!user) return
    users.get(user.id).then(setProfile)
    admin.check().then(res => setIsAdminUser(res.isAdmin))
  }, [user])

  const loadList = async (mode: 'followers' | 'following') => {
    if (!user) return
    setViewMode(mode)
    const data = mode === 'followers'
      ? await users.followers(user.id)
      : await users.following(user.id)
    if (mode === 'followers') setFollowers(data)
    else setFollowing(data)
    setShowFollowers(true)
  }

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarUploading(true)
    try {
      const avatar_url = await uploadAvatar(file)
      await refreshUser()
      setProfile((p: any) => ({ ...p, avatar_url }))
      setAvatarPreview('')
    } catch (err: any) {
      console.error('上传头像失败', err)
    } finally {
      setAvatarUploading(false)
    }
  }

  const handleSaveProfile = async () => {
    if (!user) return
    await users.update({ nickname })
    await refreshUser()
    setProfile((p: any) => ({ ...p, nickname }))
    setEditing(false)
  }

  const handleLogout = () => {
    logout()
    requestClose()
  }

  // 左侧抽屉：打开向右推出、关闭向左收回；延迟卸载以播放退出动画
  const [visible, setVisible] = useState(false)
  const [closing, setClosing] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(raf)
  }, [])
  const requestClose = () => {
    if (closing) return
    setClosing(true)
    setTimeout(onClose, 300)
  }

  if (!user) return null

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={requestClose} />
      <div ref={panelRef} className={`fixed left-0 top-0 bottom-0 z-50 w-80 bg-white/80 backdrop-blur-2xl border-r border-white/60 shadow-xl flex flex-col transform transition-transform duration-300 ease-in-out ${visible && !closing ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between p-6 border-b border-white/50">
          <h2 className="font-bold text-gray-800 flex items-center gap-2">
            <User className="w-4 h-4 text-gray-500" /> {t('个人中心')}
          </h2>
          <button onClick={requestClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
          {/* Avatar & Name */}
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-white/30 backdrop-blur-xl border border-white/40 flex items-center justify-center text-2xl font-bold text-gray-500 shadow-md ring-2 ring-gray-200/60">
              {profile?.avatar_url ? <img src={profile.avatar_url} className="w-full h-full rounded-2xl object-cover" /> : (user.nickname?.charAt(0) || '?').toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-gray-800">{profile?.nickname || user.nickname}</h3>
                <button onClick={() => { setNickname(user.nickname); setEditing(true) }}
                  className="text-gray-400 hover:text-blue-500 transition-colors">
                  <Edit3 className="w-4 h-4" />
                </button>
              </div>
              <p className="text-sm text-gray-500">{user.email}</p>
            </div>
          </div>

          <hr className="border-gray-200/60" />

          {/* Stats */}
          <div className="flex gap-6">
            <button onClick={() => loadList('followers')} className="text-center hover:text-blue-600 transition-colors">
              <div className="text-xl font-bold text-gray-800">{profile?.follower_count || 0}</div>
              <div className="text-xs text-gray-500">{t('粉丝')}</div>
            </button>
            <button onClick={() => loadList('following')} className="text-center hover:text-blue-600 transition-colors">
              <div className="text-xl font-bold text-gray-800">{profile?.following_count || 0}</div>
              <div className="text-xs text-gray-500">{t('关注')}</div>
            </button>
            <div className="text-center">
              <div className="text-xl font-bold text-gray-800">{profile?.repo_count || 0}</div>
              <div className="text-xs text-gray-500">{t('仓库')}</div>
            </div>
          </div>

          {/* Menu Items */}
          <div className="space-y-2">
            <button onClick={() => { requestClose(); navigate(`/user/${user.id}`) }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl hover:bg-white/50 transition-all text-sm text-gray-700">
              <User className="w-4 h-4 text-gray-800" /> {t('我的主页')}
            </button>
            {isAdminUser && (
              <button onClick={() => { requestClose(); navigate('/admin') }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl hover:bg-white/50 transition-all text-sm text-gray-700">
                <Settings className="w-4 h-4 text-gray-800" /> {t('管理后台')}
              </button>
            )}
            {/* 面板样式设置：弹窗 */}
            <button onClick={onOpenPanelStyleModal}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl hover:bg-white/50 transition-all text-sm text-gray-700">
              <Palette className="w-4 h-4 text-gray-800" /> {t('面板样式')}
            </button>
            {/* 壁纸管理 */}
            <button onClick={onOpenWallpaperManager}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl hover:bg-white/50 transition-all text-sm text-gray-700">
              <ImageIcon className="w-4 h-4 text-gray-800" /> {t('壁纸管理')}
            </button>
            {/* 通知：展开式列表，展开时拉取最新 */}
            <button onClick={() => { setShowNotifSettings(s => !s); if (!showNotifSettings) onFetchNotifications() }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl hover:bg-white/50 transition-all text-sm text-gray-700">
              <Bell className="w-4 h-4 text-gray-800" /> {t('通知')}
              {unreadCount > 0 && (
                <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
              <ChevronDown className={`w-4 h-4 text-gray-400 ml-auto transition-transform duration-200 ${showNotifSettings ? 'rotate-180' : ''}`} />
            </button>
            {showNotifSettings && (
              <div className="mx-1 px-3 py-3 rounded-2xl bg-white/50 border border-white/60">
                <div className="flex items-center justify-between mb-2 px-1">
                  <span className="text-xs text-gray-400">{t('{n} 条未读', { n: unreadCount })}</span>
                  {unreadCount > 0 && (
                    <button onClick={onMarkNotificationsRead} className="text-xs text-blue-500 hover:text-blue-600">{t('全部标为已读')}</button>
                  )}
                </div>
                {notifications.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6">{t('暂无通知')}</p>
                ) : (
                  <div className="space-y-1 max-h-72 overflow-y-auto">
                    {notifications.map((n: any) => (
                      <div key={n.id} className={`flex items-start gap-2.5 px-2.5 py-2 rounded-xl text-sm ${n.is_read ? 'text-gray-500' : 'text-gray-800 bg-blue-50/50'}`}>
                        <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 font-bold text-xs overflow-hidden shrink-0">
                          {n.actor_avatar ? <img src={n.actor_avatar} className="w-full h-full object-cover" /> : n.actor_name?.charAt(0)?.toUpperCase() || '?'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] leading-relaxed">{n.message}</p>
                          <p className="text-[11px] text-gray-400 mt-0.5">{new Date(n.created_at + 'Z').toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                        </div>
                        {!n.is_read && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0 mt-1.5" />}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* 语言设置 */}
            <button onClick={() => setShowLangSettings(s => !s)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl hover:bg-white/50 transition-all text-sm text-gray-700">
              <Globe className="w-4 h-4 text-gray-800" /> {t('语言')}
              <ChevronDown className={`w-4 h-4 text-gray-400 ml-auto transition-transform duration-200 ${showLangSettings ? 'rotate-180' : ''}`} />
            </button>
            {showLangSettings && (
              <div className="mx-1 px-4 py-3.5 rounded-2xl bg-white/50 border border-white/60 space-y-1">
                <button onClick={() => setLang('zh')}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm transition-all hover:bg-white/60 ${lang === 'zh' ? 'text-blue-600 font-medium' : 'text-gray-700'}`}>
                  <span>中文</span>
                  {lang === 'zh' && <Check className="w-4 h-4" />}
                </button>
                <button onClick={() => setLang('en')}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm transition-all hover:bg-white/60 ${lang === 'en' ? 'text-blue-600 font-medium' : 'text-gray-700'}`}>
                  <span>English</span>
                  {lang === 'en' && <Check className="w-4 h-4" />}
                </button>
              </div>
            )}
            {/* 下载插件：展开式，主推 Chrome 商店在线安装 */}
            <button onClick={() => setShowExtSettings(s => !s)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl hover:bg-white/50 transition-all text-sm text-gray-700">
              <Download className="w-4 h-4 text-gray-800" /> {t('下载插件')}
              <ChevronDown className={`w-4 h-4 text-gray-400 ml-auto transition-transform duration-200 ${showExtSettings ? 'rotate-180' : ''}`} />
            </button>
            {showExtSettings && (
              <div className="mx-1 px-4 py-3.5 rounded-2xl bg-white/50 border border-white/60 space-y-2.5">
                <a href="https://chromewebstore.google.com/detail/linkpad-%E6%96%B0%E6%A0%87%E7%AD%BE%E9%A1%B5/cjpglkdffginlpandblgodncddjidkmd" target="_blank" rel="noopener noreferrer"
                  className="w-full h-10 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium flex items-center justify-center gap-1.5 transition-all">
                  <Chrome className="w-4 h-4" /> {t('Chrome 商店在线安装')}
                </a>
                <p className="text-xs text-gray-400 leading-relaxed">{t('推荐在线安装，将跳转至谷歌插件商店')}</p>
                <a href="https://ug.link/yyds-enc3/filemgr/share-download/?id=7ab17e722c1d4fb98f60666fa55374c4" target="_blank" rel="noopener noreferrer"
                  className="w-full h-10 rounded-xl bg-white/60 border border-white/80 hover:bg-white/90 text-gray-600 text-sm flex items-center justify-center gap-1.5 transition-all">
                  <Download className="w-4 h-4" /> {t('无法访问谷歌商店？下载离线包')}
                </a>
                <p className="text-xs text-gray-400 leading-relaxed">{t('下载插件后，可在扩展管理加载插件，可将本站设置为浏览器主页')}</p>
              </div>
            )}
            <a href="mailto:support@linkpad.site"
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl hover:bg-white/50 transition-all text-sm text-gray-700">
              <Mail className="w-4 h-4 text-gray-800" /> {t('联系我们')}
              <span className="ml-auto text-xs text-gray-400">support@linkpad.site</span>
            </a>
          </div>
        </div>

        {/* Logout */}
        <div className="p-6 border-t border-white/50">
          <button onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-red-50 text-red-500 hover:bg-red-100 transition-all text-sm font-medium">
            <LogOut className="w-4 h-4" /> {t('退出登录')}
          </button>
        </div>
      </div>

      {/* Followers/Following Modal */}
      {showFollowers && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowFollowers(false)} />
          <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4 max-h-[70vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{viewMode === 'followers' ? t('粉丝') : t('关注')}</h3>
              <button onClick={() => setShowFollowers(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            {(viewMode === 'followers' ? followers : following).length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-8">{t('暂无数据')}</p>
            ) : (
              <div className="space-y-3">
                {(viewMode === 'followers' ? followers : following).map((u: any) => (
                  <button key={u.id} onClick={() => { setShowFollowers(false); onClose(); navigate(`/user/${u.id}`) }}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-2xl hover:bg-white/50 transition-all">
                    <div className="w-10 h-10 rounded-xl bg-white/30 backdrop-blur-xl border border-white/40 flex items-center justify-center text-gray-500 font-bold text-sm ring-2 ring-gray-200/60">
                      {u.avatar_url ? <img src={u.avatar_url} className="w-full h-full rounded-xl object-cover" /> : u.nickname?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <span className="text-sm font-medium text-gray-700">{u.nickname}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit Profile Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setEditing(false)} />
          <div className="relative bg-white rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="font-bold text-gray-800 mb-4">{t('编辑个人信息')}</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{t('头像')}</label>
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-white/30 backdrop-blur-xl border border-white/40 flex items-center justify-center text-2xl font-bold text-gray-500 overflow-hidden ring-2 ring-gray-200/60">
                    {avatarPreview ? (
                      <img src={avatarPreview} className="w-full h-full object-cover" />
                    ) : profile?.avatar_url ? (
                      <img src={profile.avatar_url} className="w-full h-full object-cover" />
                    ) : (
                      user.nickname?.charAt(0)?.toUpperCase() || '?'
                    )}
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={avatarUploading}
                    className="px-4 py-2 rounded-xl bg-white/60 border border-white/80 text-sm text-gray-600 hover:bg-white/90 transition-all disabled:opacity-50"
                  >
                    {avatarUploading ? <Loader className="w-4 h-4 inline animate-spin mr-1" /> : <Camera className="w-4 h-4 inline mr-1" />}
                    {avatarUploading ? t('上传中...') : t('选择头像')}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{t('昵称')}</label>
                <input value={nickname} onChange={e => setNickname(e.target.value)}
                  className="w-full h-12 px-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditing(false)} className="flex-1 h-11 rounded-2xl bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all">{t('取消')}</button>
                <button onClick={handleSaveProfile} className="flex-1 h-11 rounded-2xl bg-blue-500 text-white hover:bg-blue-600 transition-all">{t('保存')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
