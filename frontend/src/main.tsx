import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { I18nProvider } from './i18n'
import { AuthProvider } from './AuthContext'
import App from './App.tsx'
import RepoPage from './pages/RepoPage'
import UserPage from './pages/UserPage'
import AdminPage from './pages/AdminPage'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <BrowserRouter>
        <AuthProvider>
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
