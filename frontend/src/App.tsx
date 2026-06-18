import { Navigate, Route, Routes } from "react-router-dom";
import DashboardPage from "./pages/DashboardPage";
import SessionPage from "./pages/SessionPage";

export default function App() {
  return (
    <div className="min-h-screen bg-background text-text-primary">
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/session/:code" element={<SessionPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
