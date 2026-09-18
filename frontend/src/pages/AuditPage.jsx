import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getAuditEvents } from "../api/client";
import { useI18n } from "../i18n.jsx";

function formatTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function prettyDetails(details) {
  if (!details) return "{}";
  try {
    return JSON.stringify(JSON.parse(details), null, 2);
  } catch (_) {
    return details;
  }
}

export default function AuditPage() {
  const { code = "" } = useParams();
  const sessionCode = code.toUpperCase();
  const { t } = useI18n();
  const [session, setSession] = useState(null);
  const [events, setEvents] = useState([]);
  const [nextBeforeId, setNextBeforeId] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  async function loadPage(beforeId = 0, append = false) {
    const setBusy = append ? setLoadingMore : setLoading;
    setBusy(true);
    try {
      const res = await getAuditEvents(sessionCode, { limit: 50, beforeId });
      setSession(res.session);
      setNextBeforeId(res.next_before_id || 0);
      setEvents((prev) => (append ? [...prev, ...(res.events || [])] : (res.events || [])));
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadPage();
  }, [sessionCode]);

  const exportPayload = useMemo(() => JSON.stringify({ session, events }, null, 2), [session, events]);

  function exportJson() {
    const blob = new Blob([exportPayload], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ghosttalk-audit-${sessionCode}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (error && !session) return <section className="panel error">{error}</section>;
  if (loading && !session) return <section className="panel">{t.auditLoading}</section>;

  return (
    <section className="stack-lg">
      <div className="session-header">
        <h2>{t.auditTitle}: {session?.title || sessionCode}</h2>
        <p>{t.auditDescription}</p>
        <small>{t.joinCodeLabel}: {sessionCode}</small>
        <div className="row">
          <Link className="btn" to={`/facilitator/${sessionCode}`}>{t.auditBack}</Link>
          <button type="button" className="btn btn-primary" onClick={exportJson}>{t.auditExport}</button>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {events.length === 0 ? (
        <section className="panel">{t.auditEmpty}</section>
      ) : (
        <div className="stack-form">
          {events.map((event) => (
            <article key={event.id} className="panel stack-form">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <strong>{event.event_type}</strong>
                  <div><small>{formatTimestamp(event.created_at)}</small></div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div><small>{t.auditActor}: {event.actor_role || "-"}</small></div>
                  <div><small>{t.auditIp}: {event.client_ip || "-"}</small></div>
                </div>
              </div>
              <div><small>{t.auditUserAgent}: {event.user_agent || "-"}</small></div>
              <pre className="summary-preview">{prettyDetails(event.details)}</pre>
            </article>
          ))}
        </div>
      )}

      {nextBeforeId ? (
        <div className="row">
          <button type="button" className="btn" onClick={() => loadPage(nextBeforeId, true)} disabled={loadingMore}>
            {loadingMore ? t.auditLoadingMore : t.auditLoadMore}
          </button>
        </div>
      ) : null}
    </section>
  );
}
