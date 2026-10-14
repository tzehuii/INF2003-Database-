/**
 * Application shell and routing.
 *
 * The layout is Sidebar, Top bar, and the active page, and it stays the same on
 * every route. Navigating between pages, or switching the selected database,
 * never changes the layout.
 */

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import { BreadcrumbProvider } from './breadcrumbContext'
import { DatabaseProvider, useDatabase } from './databaseContext.tsx'
import AgencyAwardsPage from './pages/AgencyAwardsPage'
import CompaniesPage from './pages/CompaniesPage'
import CompanyDetailPage from './pages/CompanyDetailPage'
import IndustryAwardsPage from './pages/IndustryAwardsPage'
import BusinessActivitiesPage from './pages/businessActivities/BusinessActivitiesPage'
import CataloguePage from './pages/businessActivities/CataloguePage'
import CreatePage from './pages/businessActivities/CreatePage'
import DetailPage from './pages/businessActivities/DetailPage'
import SavedListsPage from './pages/SavedListsPage'
import SystemSectionPage from './pages/SystemSectionPage'
import CompaniesAddressesPage from './pages/CompaniesAddressesPage'
import { DEFAULT_SYSTEM_PATH } from './systemSections'

function AppLayout() {
  const { database } = useDatabase()

  return (
    // `data-database` drives the identity stripe along the top of the workspace.
    <div className="app-shell" data-database={database}>
      <Sidebar />
      <div className="app-workspace">
        <TopBar />
        <main className="app-main">
          <Routes>
            <Route path="/" element={<Navigate to="/companies" replace />} />
            <Route path="/companies" element={<CompaniesPage />} />
            <Route path="/companies/:uen" element={<CompanyDetailPage />} />
            <Route path="/agency-awards" element={<AgencyAwardsPage />} />
            <Route path="/industry-awards" element={<IndustryAwardsPage />} />
            <Route path="/saved-lists" element={<SavedListsPage />} />
            <Route path="/system" element={<Navigate to={DEFAULT_SYSTEM_PATH} replace />} />
            <Route path="/system/business-activities" element={<BusinessActivitiesPage />}>
              <Route index element={<CataloguePage />} />
              <Route path="new" element={<CreatePage />} />
              <Route path=":code" element={<DetailPage />} />
            </Route>
            <Route path="/system/companies-addresses/*" element={<CompaniesAddressesPage />} />
            <Route path="/system/:section" element={<SystemSectionPage />} />
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
        <BreadcrumbProvider>
          <AppLayout />
        </BreadcrumbProvider>
      </BrowserRouter>
    </DatabaseProvider>
  )
}
