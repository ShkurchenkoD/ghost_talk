import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import CardBoard from "../components/CardBoard";
import { clearSessionAccess, exportTranscript, getEventsUrl, getSession, getSessionInsights, getTranscript, listCards, patchCard, patchSession, queueSessionAnalysis, saveSummary, updateActionItem, updateTranscriptSegment } from "../api/client";
import { useI18n } from "../i18n.jsx";

export default function FacilitatorPage() {
  const { code = "" } = useParams();
  const sessionCode = code.toUpperCase();
  const { t } = useI18n();
  const [session, setSession] = useState(null);
  const [categories, setCategories] = useState([]);
  const [cards, setCards] = useState([]);
  const [transcript, setTranscript] = useState([]);
  const [transcriptFilters, setTranscriptFilters] = useState({ alias: "", language: "", fromMinutes: "" });
  const [analysisQueued, setAnalysisQueued] = useState(false);
  const [insights, setInsights] = useState(null);
  const [actionItems, setActionItems] = useState([]);
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
        const transcriptRes = await getTranscript(sessionCode);
        if (!alive) return;
        setTranscript(transcriptRes.segments || []);
        const insightsRes = await getSessionInsights(sessionCode);
        if (!alive) return;
        setInsights(insightsRes.insight || null);
        setActionItems(insightsRes.action_items || []);
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
      if (msg.type === "transcript.segment.final") {
        setTranscript((prev) => [...prev.filter((segment) => segment.id !== msg.payload.id), msg.payload]
          .sort((a, b) => a.started_at_ms - b.started_at_ms || a.id - b.id));
      }
      if (msg.type === "analysis.started") setAnalysisQueued(true);
      if (msg.type === "analysis.completed") {
        getSessionInsights(sessionCode).then((res) => {
          setInsights(res.insight || null);
          setActionItems(res.action_items || []);
          setAnalysisQueued(false);
        }).catch((err) => setError(err.message));
      }
      if (msg.type === "analysis.failed") {
        setAnalysisQueued(false);
        setError("Не вдалося сформувати висновки. Спробуйте запустити аналіз ще раз.");
      }
      if (msg.type === "action_item_updated") {
        setActionItems((prev) => prev.map((item) => item.id === msg.payload.id ? msg.payload : item));
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

  async function queueAnalysis() {
    try {
      setError("");
      await queueSessionAnalysis(sessionCode);
      setAnalysisQueued(true);
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveActionItem(item) {
    try {
      const result = await updateActionItem(item.id, {
        text: item.text,
        owner_alias: item.owner_alias || "",
        status: item.status || "open",
        due_date: item.due_date ? String(item.due_date).slice(0, 10) : "",
      });
      setActionItems((prev) => prev.map((current) => current.id === item.id ? result.action_item : current));
    } catch (err) {
      setError(err.message);
    }
  }

  async function downloadTranscript(format) {
    try {
      const blob = await exportTranscript(sessionCode, format);
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `ghosttalk-transcript-${sessionCode.toLowerCase()}.${format === "json" ? "json" : "md"}`;
      link.click();
      URL.revokeObjectURL(href);
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveTranscriptSegment(segment) {
    try {
      const result = await updateTranscriptSegment(segment.id, segment.text);
      setTranscript((prev) => prev.map((current) => current.id === segment.id ? result.segment : current));
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

  const transcriptAliases = useMemo(
    () => [...new Set(transcript.map((segment) => segment.participant_alias).filter(Boolean))].sort(),
    [transcript],
  );
  const transcriptLanguages = useMemo(
    () => [...new Set(transcript.map((segment) => segment.language).filter(Boolean))].sort(),
    [transcript],
  );
  const filteredTranscript = useMemo(() => {
    const fromMs = Math.max(0, Number(transcriptFilters.fromMinutes || 0) * 60000);
    return transcript.filter((segment) =>
      (!transcriptFilters.alias || segment.participant_alias === transcriptFilters.alias)
      && (!transcriptFilters.language || segment.language === transcriptFilters.language)
      && segment.started_at_ms >= fromMs,
    );
  }, [transcript, transcriptFilters]);

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
        <button className="btn" type="button" onClick={queueAnalysis} disabled={analysisQueued}>
          {analysisQueued ? "Аналіз у черзі" : "Створити висновки"}
        </button>
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

      <section className="panel stack-form">
        <h3>Протокол зустрічі</h3>
        <div className="row">
          <button type="button" className="btn" onClick={() => downloadTranscript("markdown")}>Експорт Markdown</button>
          <button type="button" className="btn" onClick={() => downloadTranscript("json")}>Експорт JSON</button>
        </div>
        <div className="row">
          <select aria-label="Учасник" value={transcriptFilters.alias} onChange={(event) => setTranscriptFilters((current) => ({ ...current, alias: event.target.value }))}>
            <option value="">Усі учасники</option>
            {transcriptAliases.map((alias) => <option key={alias} value={alias}>{alias}</option>)}
          </select>
          <select aria-label="Мова" value={transcriptFilters.language} onChange={(event) => setTranscriptFilters((current) => ({ ...current, language: event.target.value }))}>
            <option value="">Усі мови</option>
            {transcriptLanguages.map((language) => <option key={language} value={language}>{language}</option>)}
          </select>
          <input type="number" min="0" placeholder="Від хвилини" value={transcriptFilters.fromMinutes} onChange={(event) => setTranscriptFilters((current) => ({ ...current, fromMinutes: event.target.value }))} />
        </div>
        {transcript.length === 0 ? (
          <p>Фінальних сегментів транскрипту ще немає.</p>
        ) : filteredTranscript.length === 0 ? (
          <p>За вибраними фільтрами сегментів немає.</p>
        ) : (
          <div className="stack-sm">
            {filteredTranscript.map((segment) => (
              <div className="stack-form" key={segment.id} id={`transcript-segment-${segment.id}`}>
                <div className="transcript-segment-meta">
                  <span><strong>{segment.participant_alias}</strong>{" "}
                    <small>({Math.floor(segment.started_at_ms / 60000)}:{String(Math.floor((segment.started_at_ms % 60000) / 1000)).padStart(2, "0")})</small>
                  </span>
                  <span className="row transcript-segment-flags">
                    {segment.redacted ? <small className="transcript-flag">{t.transcriptRedacted}</small> : null}
                    {Number(segment.confidence) > 0 && Number(segment.confidence) < 0.75 ? <small className="transcript-flag is-warning">{t.transcriptLowConfidence}</small> : null}
                  </span>
                </div>
                <textarea rows={2} value={segment.text} onChange={(event) => setTranscript((prev) => prev.map((current) => current.id === segment.id ? { ...current, text: event.target.value } : current))} />
                <button type="button" className="btn" onClick={() => saveTranscriptSegment(segment)}>Зберегти фразу</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel stack-form">
        <h3>Висновки зі зустрічі</h3>
        {!insights ? (
          <p>Висновки ще не сформовані. Запустіть аналіз після появи сегментів протоколу.</p>
        ) : (
          <>
            <p>{insights.executive_summary}</p>
            {(insights.themes || []).length > 0 && <><h4>Теми</h4><ul>{insights.themes.map((item, index) => <li key={index}><strong>{item.title}</strong>: {item.summary}</li>)}</ul></>}
            {(insights.decisions || []).length > 0 && <><h4>Рішення</h4><ul>{insights.decisions.map((item, index) => <li key={index}>{item.text}</li>)}</ul></>}
            {(insights.risks_questions || []).length > 0 && <><h4>Ризики й питання</h4><ul>{insights.risks_questions.map((item, index) => <li key={index}>{item.text}</li>)}</ul></>}
          </>
        )}
        <h4>Action items</h4>
        {actionItems.length === 0 ? <p>Задач ще немає.</p> : actionItems.map((item) => (
          <div className="stack-form" key={item.id}>
            <input value={item.text} onChange={(e) => setActionItems((prev) => prev.map((current) => current.id === item.id ? { ...current, text: e.target.value } : current))} />
            <div className="row">
              <input placeholder="Відповідальний" value={item.owner_alias || ""} onChange={(e) => setActionItems((prev) => prev.map((current) => current.id === item.id ? { ...current, owner_alias: e.target.value } : current))} />
              <input type="date" aria-label="Дедлайн" value={item.due_date ? String(item.due_date).slice(0, 10) : ""} onChange={(e) => setActionItems((prev) => prev.map((current) => current.id === item.id ? { ...current, due_date: e.target.value } : current))} />
              <select value={item.status || "open"} onChange={(e) => setActionItems((prev) => prev.map((current) => current.id === item.id ? { ...current, status: e.target.value } : current))}>
                <option value="open">Відкрита</option><option value="in_progress">У роботі</option><option value="done">Готово</option>
              </select>
              <button type="button" className="btn" onClick={() => saveActionItem(item)}>Зберегти</button>
            </div>
            {Array.isArray(item.source_segment_ids) && item.source_segment_ids.length > 0 && (
              <small>
                Джерела: {item.source_segment_ids.map((segmentID, index) => (
                  <span key={segmentID}>
                    {index > 0 && ", "}
                    <a href={`#transcript-segment-${segmentID}`}>#{segmentID}</a>
                  </span>
                ))}
              </small>
            )}
          </div>
        ))}
      </section>

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
