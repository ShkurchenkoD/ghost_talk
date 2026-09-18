import { Suspense, lazy } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import CreatePage from "./pages/CreatePage";
import ParticipantPage from "./pages/ParticipantPage";
import FacilitatorPage from "./pages/FacilitatorPage";
import SummaryPage from "./pages/SummaryPage";
import AuditPage from "./pages/AuditPage";
import DashboardPage from "./pages/DashboardPage";
import SessionPage from "./pages/SessionPage";
import ParticipantDemoPage from "./pages/ParticipantDemoPage";
import ResultsPage from "./pages/ResultsPage";
import SettingsPage from "./pages/SettingsPage";
import AuthPage from "./pages/AuthPage";
import LanguageSwitch from "./components/LanguageSwitch.jsx";
import { useI18n } from "./i18n.jsx";

const VideoRoomPage = lazy(() => import("./pages/VideoRoomPage"));

const workspaceRoutes = ["/dashboard", "/create", "/live/demo", "/participant/demo", "/results/demo", "/settings"];

function AppHeader() {
  const location = useLocation();
  const { t } = useI18n();
  const isWorkspaceRoute = workspaceRoutes.some((route) => location.pathname.startsWith(route));
  const isLegacyLiveRoute =
    location.pathname.startsWith("/session/")
    || location.pathname.startsWith("/facilitator/")
    || location.pathname.startsWith("/summary/")
    || location.pathname.startsWith("/video/");

  const workspaceNav: [string, string][] = [
    ["/dashboard", t.navDashboard],
    ["/create", t.navCreate],
    ["/live/demo", t.navLive],
    ["/results/demo", t.navResults],
    ["/settings", t.navSettings],
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-white/70 bg-white/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1480px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link to="/" className="font-display text-xl font-semibold tracking-tight text-primary">
          GhostTalk
        </Link>

        {isWorkspaceRoute ? (
          <nav className="hidden items-center gap-2 md:flex">
            {workspaceNav.map(([href, label]) => (
              <Link
                key={href}
                to={href}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  location.pathname === href ? "bg-soft-purple text-primary" : "text-text-secondary hover:bg-slate-100"
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>
        ) : isLegacyLiveRoute ? (
          <div className="text-sm text-text-secondary">{t.navRealtimeWorkspace}</div>
        ) : (
          <nav className="hidden items-center gap-6 text-sm font-medium text-text-secondary md:flex">
            <a href="/#how-it-works" className="hover:text-text-primary">{t.navHowItWorks}</a>
            <a href="/#features" className="hover:text-text-primary">{t.navFeatures}</a>
            <a href="/#pricing" className="hover:text-text-primary">{t.navPricing}</a>
          </nav>
        )}

        <div className="flex items-center gap-2">
          <LanguageSwitch />
          {isWorkspaceRoute ? (
            <Link to="/participant/demo" className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
              {t.navParticipantView}
            </Link>
          ) : isLegacyLiveRoute ? null : (
            <>
              <Link to="/login" className="rounded-full px-4 py-2 text-sm font-medium text-text-secondary hover:bg-slate-100">
                {t.navLogIn}
              </Link>
              <Link to="/create" className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover">
                {t.navStartSession}
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function VideoRoomFallback() {
  const { t } = useI18n();
  return <section className="mx-auto max-w-[860px] px-4 py-6 text-text-secondary sm:px-6">{t.videoConnecting}</section>;
}

export default function App() {
  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main>
        <Routes>
          <Route path="/" element={<div className="mx-auto max-w-[1480px] px-4 py-6 sm:px-6"><LandingPage /></div>} />
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/register" element={<AuthPage mode="register" />} />
          <Route path="/forgot-password" element={<AuthPage mode="forgot" />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/create" element={<CreatePage />} />
          <Route path="/participant/demo" element={<ParticipantDemoPage />} />
          <Route path="/live/demo" element={<SessionPage />} />
          <Route path="/results/demo" element={<ResultsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/session/:code" element={<div className="page-wrap"><ParticipantPage /></div>} />
          <Route path="/facilitator/:code" element={<div className="page-wrap"><FacilitatorPage /></div>} />
          <Route path="/facilitator/:code/audit" element={<div className="page-wrap"><AuditPage /></div>} />
          <Route
            path="/video/:role/:code"
            element={(
              <Suspense fallback={<VideoRoomFallback />}>
                <VideoRoomPage />
              </Suspense>
            )}
          />
          <Route path="/summary/:code" element={<div className="page-wrap"><SummaryPage /></div>} />
        </Routes>
      </main>
    </div>
  );
}
