/**
 * Application shell and routing.
 *
 * The layout is Header, Sidebar, and the active page, and it stays the same on
 * every route. Navigating between pages, or switching the selected database,
 * never changes the layout.
 */

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppHeader from './components/AppHeader'
import Sidebar from './components/Sidebar'
import { DatabaseProvider } from './databaseContext.tsx'
import AgencyAwardsPage from './pages/AgencyAwardsPage'
import CompaniesPage from './pages/CompaniesPage'
import CompanyDetailPage from './pages/CompanyDetailPage'
import IndustryAwardsPage from './pages/IndustryAwardsPage'
import SavedListsPage from './pages/SavedListsPage'

function AppLayout() {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-workspace">
        <AppHeader />
        <main className="app-main">
          <Routes>
            <Route path="/" element={<Navigate to="/companies" replace />} />
            <Route path="/companies" element={<CompaniesPage />} />
            <Route path="/companies/:uen" element={<CompanyDetailPage />} />
            <Route path="/agency-awards" element={<AgencyAwardsPage />} />
            <Route path="/industry-awards" element={<IndustryAwardsPage />} />
            <Route path="/saved-lists" element={<SavedListsPage />} />
            <Route path="*" element={<Navigate to="/companies" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <DatabaseProvider>
      <BrowserRouter>
        <AppLayout />
      </BrowserRouter>
    </DatabaseProvider>
  )
}
