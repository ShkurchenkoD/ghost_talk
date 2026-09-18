import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { getSummary } from "../api/client";
import { useI18n } from "../i18n.jsx";

function buildMarkdown({ session, summary, topCards, t }) {
  const topList = topCards.map((c) => `- (${c.vote_count} votes) [${c.category}] ${c.text}`).join("\n");
  return [
    `# GhostTalk Summary - ${session?.title || "Session"}`,
    "",
    "## Top Voted Ideas",
    topList || "- No cards yet",
    "",
    `## ${t.groupedThoughts}`,
    summary?.grouped_thoughts || "",
    "",
    `## ${t.risksQuestions}`,
    summary?.risks_questions || "",
    "",
    `## ${t.actionItems}`,
    summary?.action_items || "",
    "",
    "## Facilitator Notes",
    summary?.markdown || "",
    "",
  ].join("\n");
}

export default function SummaryPage() {
  const { code = "" } = useParams();
  const sessionCode = code.toUpperCase();
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await getSummary(sessionCode, "");
        setData(res);
      } catch (err) {
        setError(err.message);
      }
    })();
  }, [sessionCode]);

  const markdown = useMemo(() => {
    if (!data) return "";
    return buildMarkdown({ session: data.session, summary: data.summary, topCards: data.top_cards || [], t });
  }, [data, t]);

  function exportMarkdown() {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ghosttalk-summary-${sessionCode}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (error) return <section className="panel error">{error}</section>;
  if (!data) return <section className="panel">{t.loadingSummary}</section>;

  return (
    <section className="panel stack-form">
      <h2>{t.summaryTitle}: {data.session.title}</h2>
      <p>{data.session.description}</p>
      <button className="btn" onClick={exportMarkdown}>{t.exportMd}</button>
      <pre className="summary-preview">{markdown}</pre>
    </section>
  );
}
