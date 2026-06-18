import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useI18n } from "../i18n.jsx";

export default function LandingPage() {
  const [code, setCode] = useState("");
  const navigate = useNavigate();
  const { t } = useI18n();

  return (
    <section className="hero">
      <div className="hero-card">
        <h1>{t.landingTitle}</h1>
        <p>{t.landingText}</p>
        <div className="hero-actions">
          <Link to="/create" className="btn btn-primary">{t.createSession}</Link>
          <form
            className="join-inline"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim()) navigate(`/session/${code.trim().toUpperCase()}`);
            }}
          >
            <input placeholder={t.joinCode} value={code} onChange={(e) => setCode(e.target.value)} maxLength={8} />
            <button className="btn" type="submit">{t.joinSession}</button>
          </form>
        </div>
      </div>
    </section>
  );
}
