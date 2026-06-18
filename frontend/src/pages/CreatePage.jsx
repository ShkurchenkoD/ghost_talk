import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createSession } from "../api/client";
import { METHODOLOGIES, facilitatorKey } from "../api/sessionState";
import { useI18n } from "../i18n.jsx";

export default function CreatePage() {
  const navigate = useNavigate();
  const { t, methodLabel } = useI18n();
  const [form, setForm] = useState({
    title: "",
    description: "",
    methodology: "brainwriting",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await createSession(form);
      localStorage.setItem(facilitatorKey(res.session.code), res.facilitator_token);
      navigate(`/facilitator/${res.session.code}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel">
      <h2>{t.createTitle}</h2>
      <form onSubmit={onSubmit} className="stack-form">
        <label>
          {t.title}
          <input required maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </label>
        <label>
          {t.description}
          <textarea maxLength={1000} rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </label>
        <label>
          {t.methodology}
          <select value={form.methodology} onChange={(e) => setForm({ ...form, methodology: e.target.value })}>
            {METHODOLOGIES.map((m) => (
              <option key={m.value} value={m.value}>{methodLabel(m.value)}</option>
            ))}
          </select>
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary" disabled={loading}>{loading ? t.creating : t.create}</button>
      </form>
    </section>
  );
}
