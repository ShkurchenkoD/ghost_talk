import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import CardBoard from "../components/CardBoard";
import { createCard, getEventsUrl, getSession, joinSession, listCards, voteCard } from "../api/client";
import { participantKey } from "../api/sessionState";
import { useI18n } from "../i18n.jsx";

export default function ParticipantPage() {
  const { code = "" } = useParams();
  const sessionCode = code.toUpperCase();
  const { t, methodLabel } = useI18n();
  const [session, setSession] = useState(null);
  const [categories, setCategories] = useState([]);
  const [cards, setCards] = useState([]);
  const [token, setToken] = useState("");
  const [text, setText] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const sessionRes = await getSession(sessionCode);
        if (!alive) return;
        setSession(sessionRes.session);
        setCategories(sessionRes.categories);
        setCategory(sessionRes.categories[0] || "ideas");

        let currentToken = localStorage.getItem(participantKey(sessionCode));
        if (!currentToken) {
          const joinRes = await joinSession(sessionCode);
          currentToken = joinRes.participant_token;
          localStorage.setItem(participantKey(sessionCode), currentToken);
        }
        if (!alive) return;
        setToken(currentToken);

        const cardsRes = await listCards(sessionCode);
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
      if (msg.type === "session_updated") {
        setSession(msg.payload);
      }
      if (msg.type === "card_created") {
        setCards((prev) => [msg.payload, ...prev.filter((c) => c.id !== msg.payload.id)]);
      }
      if (msg.type === "card_updated" || msg.type === "card_voted") {
        setCards((prev) => prev.map((c) => (c.id === msg.payload.id ? msg.payload : c)));
      }
    };
    return () => es.close();
  }, [sessionCode]);

  const canVote = useMemo(() => Boolean(session?.voting_open) && !session?.ended_at, [session]);

  async function submitCard(e) {
    e.preventDefault();
    setError("");
    try {
      await createCard(sessionCode, { text, category }, token);
      setText("");
    } catch (err) {
      setError(err.message);
    }
  }

  async function onVote(cardId) {
    try {
      await voteCard(cardId, token);
    } catch (err) {
      setError(err.message);
    }
  }

  function mockVoice() {
    const spoken = window.prompt(t.mockVoicePrompt);
    if (spoken) setText((prev) => `${prev}${prev ? " " : ""}${spoken}`);
  }

  if (error && !session) return <section className="panel error">{error}</section>;
  if (!session) return <section className="panel">{t.loadingSession}</section>;

  return (
    <section className="stack-lg">
      <div className="session-header">
        <h2>{session.title}</h2>
        <p>{session.description}</p>
        <small>{t.joinCode}: {session.code} · {t.methodLabel}: {methodLabel(session.methodology)}</small>
      </div>

      <form className="stack-form" onSubmit={submitCard}>
        <h3>{t.addThought}</h3>
        <textarea required rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row">
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c} value={c}>{methodLabel(c)}</option>
            ))}
          </select>
          <button type="button" className="btn" onClick={mockVoice}>{t.voiceMock}</button>
          <button className="btn btn-primary" type="submit">{t.submit}</button>
        </div>
      </form>

      {error && <p className="error">{error}</p>}

      <CardBoard categories={categories} cards={cards} onVote={onVote} canVote={canVote} />
    </section>
  );
}
