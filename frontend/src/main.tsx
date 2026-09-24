import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './AuthContext'
import App from './App.tsx'
import RepoPage from './pages/RepoPage'
import UserPage from './pages/UserPage'
import AdminPage from './pages/AdminPage'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
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
  </StrictMode>
)
