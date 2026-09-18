import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import CardBoard from "../components/CardBoard";
import { clearSessionAccess, getEventsUrl, getSession, listCards, patchCard, patchSession, saveSummary } from "../api/client";
import { useI18n } from "../i18n.jsx";

export default function FacilitatorPage() {
  const { code = "" } = useParams();
  const sessionCode = code.toUpperCase();
  const { t } = useI18n();
  const [session, setSession] = useState(null);
  const [categories, setCategories] = useState([]);
  const [cards, setCards] = useState([]);
  const [summary, setSummary] = useState({
    markdown: "",
    grouped_thoughts: "",
    risks_questions: "",
    action_items: "",
  });
  const [error, setError] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const sessionRes = await getSession(sessionCode);
        if (!alive) return;
        setSession(sessionRes.session);
        setCategories(sessionRes.categories);
        const cardsRes = await listCards(sessionCode, true);
        if (!alive) return;
        setCards(cardsRes.cards);
      } catch (err) {
        setError(err.message);
      }
    })();

    return () => {
      alive = false;
    };
  }, [sessionCode]);

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
      await patchCard(id, payload, "");
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleVoting(open) {
    try {
      await patchSession(sessionCode, { voting_open: open }, "");
    } catch (err) {
      setError(err.message);
    }
  }

  async function endSession() {
    try {
      await patchSession(sessionCode, { end_session: true }, "");
    } catch (err) {
      setError(err.message);
    }
  }

  async function copyJoinLink(url) {
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveSummaryForm(e) {
    e.preventDefault();
    try {
      await saveSummary(sessionCode, summary, "");
    } catch (err) {
      setError(err.message);
    }
  }

  async function resetAccess() {
    try {
      await clearSessionAccess("facilitator", sessionCode);
      window.location.assign("/");
    } catch (err) {
      setError(err.message);
    }
  }

  if (error && !session) return <section className="panel error">{error}</section>;
  if (!session) return <section className="panel">{t.loadingFacilitator}</section>;

  return (
    <section className="stack-lg">
      <div className="session-header">
        <h2>{t.facilitator}: {session.title}</h2>
        <p>{session.description}</p>
        <small>{t.joinCodeLabel}: {session.code}</small>
        <label>
          {t.joinLinkLabel}
          <div className="join-inline">
            <input type="text" readOnly value={`${window.location.origin}/session/${session.code}`} onFocus={(e) => e.target.select()} />
            <button type="button" className="btn" onClick={() => copyJoinLink(`${window.location.origin}/session/${session.code}`)}>
              {linkCopied ? t.linkCopied : t.copyLink}
            </button>
          </div>
        </label>
      </div>

      <div className={`video-call-card${session.video_enabled ? "" : " is-disabled"}`}>
        <div>
          <strong>{session.video_enabled ? t.videoSession : t.videoUnavailableTitle}</strong>
          <p>{session.video_enabled ? t.videoNoAccount : t.videoUnavailableHint}</p>
        </div>
        <div className="row">
          {session.video_enabled ? (
            <Link className="btn btn-primary" to={`/video/facilitator/${session.code}`}>{t.openVideo}</Link>
          ) : (
            <button type="button" className="btn btn-primary" disabled>{t.openVideo}</button>
          )}
        </div>
      </div>

      <div className="row">
        <button className="btn" onClick={() => toggleVoting(!session.voting_open)}>
          {session.voting_open ? t.stopVoting : t.startVoting}
        </button>
        <button className="btn" onClick={endSession} disabled={Boolean(session.ended_at)}>{t.endSession}</button>
        <Link className="btn" to={`/summary/${session.code}`}>{t.openSummary}</Link>
        <Link className="btn" to={`/facilitator/${session.code}/audit`}>{t.openAudit}</Link>
        <button className="btn" type="button" onClick={resetAccess}>{t.resetAccess}</button>
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
