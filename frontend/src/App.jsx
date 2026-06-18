import { Link, Route, Routes } from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import CreatePage from "./pages/CreatePage";
import ParticipantPage from "./pages/ParticipantPage";
import FacilitatorPage from "./pages/FacilitatorPage";
import SummaryPage from "./pages/SummaryPage";
import { useI18n } from "./i18n.jsx";
import LanguageSwitch from "./components/LanguageSwitch";

export default function App() {
  const { t } = useI18n();

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="logo">GhostTalk</Link>
        <div className="topbar-right">
          <span className="tagline">{t.appTagline}</span>
          <LanguageSwitch />
        </div>
      </header>
      <main className="page-wrap">
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/create" element={<CreatePage />} />
          <Route path="/session/:code" element={<ParticipantPage />} />
          <Route path="/facilitator/:code" element={<FacilitatorPage />} />
          <Route path="/summary/:code" element={<SummaryPage />} />
        </Routes>
      </main>
    </div>
  );
}
