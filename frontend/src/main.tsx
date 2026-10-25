import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { I18nProvider } from './i18n'
import { AuthProvider } from './AuthContext'
import App from './App.tsx'
import RepoPage from './pages/RepoPage'
import UserPage from './pages/UserPage'
import AdminPage from './pages/AdminPage'
import ExtensionBridge from './components/ExtensionBridge'
import ActivityTracker from './components/ActivityTracker'
import './index.css'

// Chrome Web Store 安装版会把 install_id 放在 hash 中（URL fragment 不会发送到服务端）
const extensionInstallId = new URLSearchParams(window.location.hash.slice(1)).get('linkpad_install_id')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <BrowserRouter>
        <AuthProvider>
          <ActivityTracker />
          <ExtensionBridge installId={extensionInstallId} />
          <Routes>
            <Route path="/" element={<App />} />
            <Route path="/repo/:id" element={<RepoPage />} />
            <Route path="/user/:id" element={<UserPage />} />
            <Route path="/admin" element={<AdminPage />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </I18nProvider>
  </StrictMode>
)
