import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import CardBoard from "../components/CardBoard";
import { getEventsUrl, getSession, listCards, patchCard, patchSession, saveSummary } from "../api/client";
import { facilitatorKey } from "../api/sessionState";
import { useI18n } from "../i18n.jsx";

export default function FacilitatorPage() {
  const { code = "" } = useParams();
  const sessionCode = code.toUpperCase();
  const { t } = useI18n();
  const [session, setSession] = useState(null);
  const [categories, setCategories] = useState([]);
  const [cards, setCards] = useState([]);
  const [token, setToken] = useState("");
  const [summary, setSummary] = useState({
    markdown: "",
    grouped_thoughts: "",
    risks_questions: "",
    action_items: "",
  });
  const [error, setError] = useState("");

  useEffect(() => {
    const facilitatorToken = localStorage.getItem(facilitatorKey(sessionCode)) || "";
    if (!facilitatorToken) {
      const typed = window.prompt(t.facilitatorTokenRequired);
      if (typed) {
        localStorage.setItem(facilitatorKey(sessionCode), typed.trim());
        setToken(typed.trim());
      }
    } else {
      setToken(facilitatorToken);
    }
  }, [sessionCode, t.facilitatorTokenRequired]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    (async () => {
      try {
        const sessionRes = await getSession(sessionCode);
        if (!alive) return;
        setSession(sessionRes.session);
        setCategories(sessionRes.categories);
        const cardsRes = await listCards(sessionCode, true, token);
        if (!alive) return;
        setCards(cardsRes.cards);
      } catch (err) {
        setError(err.message);
      }
    })();

    return () => {
      alive = false;
    };
  }, [sessionCode, token]);

  useEffect(() => {
    if (!sessionCode) return;
    const es = new EventSource(getEventsUrl(sessionCode));
    es.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "session_updated") setSession(msg.payload);
      if (msg.type === "card_created") {
        setCards((prev) => [msg.payload, ...prev.filter((c) => c.id !== msg.payload.id)]);
      }
      if (msg.type === "card_updated" || msg.type === "card_voted") {
        setCards((prev) => prev.map((c) => (c.id === msg.payload.id ? msg.payload : c)));
      }
    };
    return () => es.close();
  }, [sessionCode]);

  async function updateCard(id, payload) {
    try {
      await patchCard(id, payload, token);
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleVoting(open) {
    try {
      await patchSession(sessionCode, { voting_open: open }, token);
    } catch (err) {
      setError(err.message);
    }
  }

  async function endSession() {
    try {
      await patchSession(sessionCode, { end_session: true }, token);
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveSummaryForm(e) {
    e.preventDefault();
    try {
      await saveSummary(sessionCode, summary, token);
    } catch (err) {
      setError(err.message);
    }
  }

  if (!token) return <section className="panel">{t.missingFacilitatorToken}</section>;
  if (error && !session) return <section className="panel error">{error}</section>;
  if (!session) return <section className="panel">{t.loadingFacilitator}</section>;

  return (
    <section className="stack-lg">
      <div className="session-header">
        <h2>{t.facilitator}: {session.title}</h2>
        <p>{session.description}</p>
        <small>{t.joinCodeLabel}: {session.code}</small>
      </div>

      <div className="row">
        <button className="btn" onClick={() => toggleVoting(!session.voting_open)}>
          {session.voting_open ? t.stopVoting : t.startVoting}
        </button>
        <button className="btn" onClick={endSession} disabled={Boolean(session.ended_at)}>{t.endSession}</button>
        <Link className="btn" to={`/summary/${session.code}`}>{t.openSummary}</Link>
      </div>

      {error && <p className="error">{error}</p>}

      <CardBoard
        categories={categories}
        cards={cards}
        facilitator
        onPatch={updateCard}
        canVote={false}
      />

      <form className="stack-form" onSubmit={saveSummaryForm}>
        <h3>{t.summaryEditor}</h3>
        <label>
          {t.topIdeasNotes}
          <textarea rows={5} value={summary.markdown} onChange={(e) => setSummary({ ...summary, markdown: e.target.value })} />
        </label>
        <label>
          {t.groupedThoughts}
          <textarea rows={3} value={summary.grouped_thoughts} onChange={(e) => setSummary({ ...summary, grouped_thoughts: e.target.value })} />
        </label>
        <label>
          {t.risksQuestions}
          <textarea rows={3} value={summary.risks_questions} onChange={(e) => setSummary({ ...summary, risks_questions: e.target.value })} />
        </label>
        <label>
          {t.actionItems}
          <textarea rows={3} value={summary.action_items} onChange={(e) => setSummary({ ...summary, action_items: e.target.value })} />
        </label>
        <button className="btn btn-primary" type="submit">{t.saveSummary}</button>
      </form>
    </section>
  );
}
