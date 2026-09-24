import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import { users, follows, uploadAvatar, admin } from '../api'
import { X, User, Users, Edit3, LogOut, Camera, Loader, Settings, Download } from 'lucide-react'

interface Props {
  onClose: () => void
}

export default function UserPanel({ onClose }: Props) {
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
    onClose()
  }

  if (!user) return null

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div ref={panelRef} className="fixed right-0 top-0 bottom-0 z-50 w-80 bg-white/90 backdrop-blur-xl border-l border-white/60 shadow-xl flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-white/50">
          <h2 className="font-bold text-gray-800">个人中心</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
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
              <div className="text-xs text-gray-500">粉丝</div>
            </button>
            <button onClick={() => loadList('following')} className="text-center hover:text-blue-600 transition-colors">
              <div className="text-xl font-bold text-gray-800">{profile?.following_count || 0}</div>
              <div className="text-xs text-gray-500">关注</div>
            </button>
            <div className="text-center">
              <div className="text-xl font-bold text-gray-800">{profile?.repo_count || 0}</div>
              <div className="text-xs text-gray-500">仓库</div>
            </div>
          </div>

          {/* Menu Items */}
          <div className="space-y-2">
            <button onClick={() => { onClose(); navigate(`/user/${user.id}`) }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl hover:bg-white/50 transition-all text-sm text-gray-700">
              <User className="w-4 h-4 text-blue-500" /> 我的主页
            </button>
            {isAdminUser && (
              <button onClick={() => { onClose(); navigate('/admin') }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl hover:bg-white/50 transition-all text-sm text-gray-700">
                <Settings className="w-4 h-4 text-gray-400" /> 管理后台
              </button>
            )}
            <a href="https://ug.link/yyds-enc3/filemgr/share-download/?id=7ab17e722c1d4fb98f60666fa55374c4" target="_blank" rel="noopener noreferrer"
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl hover:bg-white/50 transition-all text-sm text-gray-700">
              <Download className="w-4 h-4 text-green-500" /> 下载插件
            </a>
            <p className="text-xs text-gray-400 leading-relaxed px-1">下载插件后，可在扩展管理加载插件，可将本站设置为浏览器主页</p>
          </div>
        </div>

        {/* Logout */}
        <div className="p-6 border-t border-white/50">
          <button onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-red-50 text-red-500 hover:bg-red-100 transition-all text-sm font-medium">
            <LogOut className="w-4 h-4" /> 退出登录
          </button>
        </div>
      </div>

      {/* Followers/Following Modal */}
      {showFollowers && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowFollowers(false)} />
          <div className="relative bg-white/90 backdrop-blur-xl rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4 max-h-[70vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{viewMode === 'followers' ? '粉丝' : '关注'}</h3>
              <button onClick={() => setShowFollowers(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            {(viewMode === 'followers' ? followers : following).length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-8">暂无数据</p>
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
          <div className="relative bg-white/90 backdrop-blur-xl rounded-3xl border border-white/60 shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="font-bold text-gray-800 mb-4">编辑个人信息</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">头像</label>
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
                    {avatarUploading ? '上传中...' : '选择头像'}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">昵称</label>
                <input value={nickname} onChange={e => setNickname(e.target.value)}
                  className="w-full h-12 px-4 bg-white/60 border border-white/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-800" />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditing(false)} className="flex-1 h-11 rounded-2xl border border-white/80 text-gray-600 hover:bg-white/50 transition-all">取消</button>
                <button onClick={handleSaveProfile} className="flex-1 h-11 rounded-2xl bg-blue-500 text-white hover:bg-blue-600 transition-all">保存</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
