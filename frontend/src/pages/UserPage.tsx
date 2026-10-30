import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import { users, follows } from '../api'
import { useT } from '../i18n'
import { UserPageSkeleton } from '../components/Skeleton'
import { Home, Heart, ExternalLink, Lock, Globe } from 'lucide-react'

export default function UserPage() {
  const t = useT()
  const { id } = useParams<{ id: string }>()
  const { user: currentUser } = useAuth()
  const navigate = useNavigate()
  const [profile, setProfile] = useState<any>(null)
  const [repos, setRepos] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [isFollowing, setIsFollowing] = useState(false)

  useEffect(() => {
    if (!id) return
    users.get(id).then((p) => {
      setProfile(p)
      setLoading(false)
      if (p.is_following !== undefined) setIsFollowing(p.is_following)
    })
    users.repos(id).then(setRepos).catch(() => {})
  }, [id])

  const toggleFollow = async () => {
    if (!id || !currentUser) return
    try {
      if (isFollowing) {
        await follows.user.unfollow(id)
        setIsFollowing(false)
        setProfile((p: any) => ({ ...p, follower_count: Math.max(0, p.follower_count - 1) }))
      } else {
        await follows.user.follow(id)
        setIsFollowing(true)
        setProfile((p: any) => ({ ...p, follower_count: p.follower_count + 1 }))
      }
    } catch { /* ignore */ }
  }

  if (loading) return <UserPageSkeleton />

  if (!profile) return <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-sky-50 flex items-center justify-center text-gray-500">{t('用户不存在')}</div>

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-sky-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <button onClick={() => navigate('/')} className="flex items-center gap-2 text-gray-400 hover:text-blue-500 mb-6 transition-colors text-sm">
          <Home className="w-4 h-4" /> {t('首页')}
        </button>

        {/* Profile Card */}
        <div className="bg-white/30 backdrop-blur-xl rounded-3xl border border-white/60 p-8 mb-6">
          <div className="flex items-center gap-6">
            <div className="w-20 h-20 rounded-3xl bg-white/30 backdrop-blur-xl border border-white/40 flex items-center justify-center text-3xl font-bold text-gray-500 shadow-lg ring-2 ring-gray-200/60 overflow-hidden">
              {profile.avatar_url ? <img src={profile.avatar_url} className="w-full h-full rounded-3xl object-cover" /> : profile.nickname?.charAt(0)?.toUpperCase() || '?'}
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-gray-800">{profile.nickname}</h1>
              <p className="text-sm text-gray-500">{profile.email}</p>
              <div className="flex gap-6 mt-3">
                <div className="text-center">
                  <div className="font-bold text-gray-800">{profile.follower_count}</div>
                  <div className="text-xs text-gray-500">{t('粉丝')}</div>
                </div>
                <div className="text-center">
                  <div className="font-bold text-gray-800">{profile.following_count}</div>
                  <div className="text-xs text-gray-500">{t('关注')}</div>
                </div>
                <div className="text-center">
                  <div className="font-bold text-gray-800">{profile.repo_count}</div>
                  <div className="text-xs text-gray-500">{t('仓库')}</div>
                </div>
              </div>
            </div>
            {currentUser && currentUser.id !== id && (
              <button onClick={toggleFollow}
                className={`px-6 py-3 rounded-2xl font-medium text-sm transition-all flex-shrink-0 ${isFollowing ? 'bg-white/60 border border-white/80 text-gray-600 hover:bg-white/80' : 'bg-blue-500 text-white hover:bg-blue-600 shadow-sm'}`}>
                {isFollowing ? t('取消关注') : t('关注')}
              </button>
            )}
          </div>
        </div>

        {/* Repos List */}
        <div className="bg-white/30 backdrop-blur-xl rounded-3xl border border-white/60 p-6">
          <h2 className="text-lg font-bold text-gray-800 mb-4">
            {t('创建的仓库 ({n})', { n: repos.length })}
          </h2>
          {repos.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-8">{t('暂无仓库')}</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {repos.map((repo: any) => (
                <button key={repo.id} onClick={() => window.open(`/repo/${repo.id}`, '_blank')}
                  className="text-left bg-white/20 hover:bg-white/40 border border-gray-200/40 hover:border-gray-300/60 rounded-2xl p-4 transition-all ring-1 ring-black/[0.06] group">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold shadow-sm flex-shrink-0 overflow-hidden"
                      style={repo.icon_key ? { backgroundColor: '#FFFFFF', border: '1px solid #e5e7eb' } : { backgroundColor: repo.bg_color || '#3B82F6', color: repo.text_color || '#FFFFFF' }}>
                      {repo.icon_key ? <img src={repo.icon_key} alt="" className="w-full h-full object-contain p-1" /> : (repo.icon || repo.name?.charAt(0) || '?')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-800 text-sm truncate">{repo.name}</h3>
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        <span>{t('{n} 个链接', { n: repo.link_count || 0 })}</span>
                        <span>·</span>
                        <span className="flex items-center gap-1">
                          {repo.visibility === 'public' ? <Globe className="w-3 h-3" /> : repo.visibility === 'password' ? <Lock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                          {repo.visibility === 'public' ? t('公开') : repo.visibility === 'password' ? t('密码') : t('私密')}
                        </span>
                      </div>
                    </div>
                    <ExternalLink className="w-4 h-4 text-gray-300 group-hover:text-blue-500 transition-colors flex-shrink-0" />
                  </div>
                  {repo.description && <p className="text-xs text-gray-400 line-clamp-2">{repo.description}</p>}
                  <div className="flex items-center gap-3 mt-2 pt-2 border-t border-white/20 text-xs text-gray-400">
                    <span className="flex items-center gap-1"><Heart className="w-3 h-3" /> {repo.follower_count || 0}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
