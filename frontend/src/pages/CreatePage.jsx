import { useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Copy, Globe2, Loader2, LockKeyhole, Mail, Mic, QrCode, Sparkles, Vote } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { useI18n } from "../i18n.jsx";
import { createSession } from "../api/client";
import { analyzeSessionDescription } from "../lib/sessionAiAssistant";

const SESSION_TYPE_TO_METHODOLOGY = {
  feedback: "anonymous_qa",
  brainstorm: "brainwriting",
  retro: "start_stop_continue",
  risk: "swot",
  delphi: "start_stop_continue",
  custom: "brainwriting",
};

function deriveTitleFromText(text) {
  const clean = text.trim().replace(/\s+/g, " ");
  if (!clean) return "";
  return clean.length > 70 ? `${clean.slice(0, 67)}...` : clean;
}

export default function CreatePage() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const sessionTypes = t.createSessionTypes;
  const votingModes = t.createVotingModes;

  const [sessionType, setSessionType] = useState("brainstorm");
  const [form, setForm] = useState({
    title: "Product feedback pulse for onboarding",
    description: "Collect anonymous ideas about the first-week team experience and prioritize the best changes.",
    workspace: "GhostTalk Core Team",
    language: "English",
    deadline: "Today, 17:00",
    anonymous: true,
    comments: true,
    multipleResponses: true,
    visibleResults: false,
    moderation: true,
    voting: votingModes[2],
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createdSession, setCreatedSession] = useState(null);

  const [aiMode, setAiMode] = useState(true);
  const [aiText, setAiText] = useState("");
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);

  async function handleCreateSession(overrides = {}) {
    const typeId = overrides.sessionType ?? sessionType;
    const title = overrides.title ?? form.title;
    const description = overrides.description ?? form.description;
    setCreating(true);
    setCreateError("");
    try {
      const methodology = SESSION_TYPE_TO_METHODOLOGY[typeId] || "brainwriting";
      const res = await createSession({ title, description, methodology });
      setCreatedSession(res.session);
      navigate(`/facilitator/${res.session.code}`);
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  }

  const selectedSession = useMemo(
    () => sessionTypes.find((type) => type.id === sessionType) ?? sessionTypes[0],
    [sessionType, sessionTypes],
  );

  const suggestedSession = useMemo(
    () => (aiSuggestion ? sessionTypes.find((type) => type.id === aiSuggestion.sessionTypeId) ?? sessionTypes[0] : null),
    [aiSuggestion, sessionTypes],
  );

  function toggleField(key) {
    setForm((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleAnalyze() {
    if (!aiText.trim()) {
      setAiError(t.createAiEmptyError);
      setAiSuggestion(null);
      return;
    }
    setAiError("");
    setAiAnalyzing(true);
    setTimeout(() => {
      setAiSuggestion(analyzeSessionDescription(aiText));
      setAiAnalyzing(false);
    }, 400);
  }

  function applyAiSuggestionToForm() {
    if (!aiSuggestion) return;
    setSessionType(aiSuggestion.sessionTypeId);
    setForm((prev) => ({
      ...prev,
      description: aiText.trim() || prev.description,
      anonymous: true,
      voting: votingModes[aiSuggestion.votingModeIndex],
    }));
  }

  function switchToManual() {
    applyAiSuggestionToForm();
    setAiMode(false);
  }

  function handleCreateFromAi() {
    if (!aiSuggestion) return;
    const title = deriveTitleFromText(aiText) || form.title;
    applyAiSuggestionToForm();
    handleCreateSession({ title, description: aiText, sessionType: aiSuggestion.sessionTypeId });
  }

  function toggleListening() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setAiError(t.createAiVoiceUnsupported);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = lang === "uk" ? "uk-UA" : "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    let finalText = aiText ? `${aiText} ` : "";
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += `${result[0].transcript} `;
        } else {
          interim += result[0].transcript;
        }
      }
      setAiText(`${finalText}${interim}`.trim());
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setAiError("");
    setListening(true);
    recognition.start();
  }

  return (
    <div className="mx-auto w-full max-w-[1480px] px-4 py-6 sm:px-6">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-5">
          {aiMode ? (
            <>
              <Card className="rounded-[2rem] border-none bg-slate-950 text-white shadow-[0_24px_70px_rgba(15,23,42,0.28)]">
                <CardContent className="flex flex-col gap-4 p-8">
                  <Badge className="w-fit gap-1 bg-white/12 text-white">
                    <Sparkles className="h-3.5 w-3.5" /> {t.createFlowBadge}
                  </Badge>
                  <div>
                    <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                      {t.createAiHeroTitle}
                    </h1>
                    <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
                      {t.createAiHeroDesc}
                    </p>
                  </div>

                  <div className="relative">
                    <textarea
                      rows={4}
                      className="w-full rounded-2xl border border-white/15 bg-white/5 px-4 py-3 pr-12 text-white placeholder:text-slate-400"
                      placeholder={t.createAiPlaceholder}
                      value={aiText}
                      onChange={(event) => setAiText(event.target.value)}
                    />
                    <button
                      type="button"
                      onClick={toggleListening}
                      title={listening ? t.createAiListening : undefined}
                      className={`absolute right-3 top-3 rounded-full p-2 transition-colors ${
                        listening ? "bg-red-500/20 text-red-300" : "bg-white/10 text-white hover:bg-white/20"
                      }`}
                    >
                      <Mic className={`h-4 w-4 ${listening ? "animate-pulse" : ""}`} />
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {t.createAiChips.map((chip) => (
                      <button
                        key={chip.label}
                        type="button"
                        onClick={() => setAiText(chip.text)}
                        className="rounded-full border border-white/15 px-4 py-2 text-sm text-slate-200 hover:bg-white/10"
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>

                  {aiError ? <p className="text-sm font-medium text-red-400">{aiError}</p> : null}

                  <Button className="rounded-2xl" disabled={aiAnalyzing} onClick={handleAnalyze}>
                    {aiAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {aiAnalyzing ? t.createAiAnalyzing : t.createAiAnalyzeCta}
                  </Button>
                </CardContent>
              </Card>

              {aiSuggestion && suggestedSession ? (
                <Card className="rounded-[2rem]">
                  <CardContent className="space-y-3 p-6">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-600">
                      {t.createAiSectionBadge}
                    </p>

                    <AiSuggestionRow
                      label={t.createAiMethodologyLabel}
                      value={suggestedSession.title}
                      reason={t.createAiReasonByType[aiSuggestion.sessionTypeId]}
                      changeCta={t.createAiChangeCta}
                      onChange={switchToManual}
                    />
                    <AiSuggestionRow
                      label={t.createAiAnonymityLabel}
                      value={t.createParticipationOptions[0][1]}
                      reason={aiSuggestion.anonymityExplicit ? t.createAiReasonAnonymityExplicit : t.createAiReasonAnonymityDefault}
                      changeCta={t.createAiChangeCta}
                      onChange={switchToManual}
                    />
                    <AiSuggestionRow
                      label={t.createAiVotingLabel}
                      value={votingModes[aiSuggestion.votingModeIndex]}
                      reason={t.createAiReasonByVoting[aiSuggestion.votingModeIndex]}
                      changeCta={t.createAiChangeCta}
                      onChange={switchToManual}
                    />

                    {createError ? <p className="text-sm font-medium text-red-600">{createError}</p> : null}

                    <div className="grid gap-2 pt-2">
                      <Button
                        className="rounded-2xl bg-emerald-500 text-white hover:bg-emerald-600"
                        disabled={creating}
                        onClick={handleCreateFromAi}
                      >
                        {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        {t.createAiCreateCta}
                      </Button>
                      <button
                        type="button"
                        onClick={switchToManual}
                        className="text-center text-sm font-medium text-text-secondary underline underline-offset-2 hover:text-text-primary"
                      >
                        {t.createAiManualLink}
                      </button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="text-center">
                  <button
                    type="button"
                    onClick={switchToManual}
                    className="text-sm font-medium text-text-secondary underline underline-offset-2 hover:text-text-primary"
                  >
                    {t.createAiManualLink}
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <Card className="rounded-[2rem] border-none bg-slate-950 text-white shadow-[0_24px_70px_rgba(15,23,42,0.28)]">
                <CardContent className="flex flex-col gap-4 p-8">
                  <div className="flex items-center justify-between gap-3">
                    <Badge className="w-fit bg-white/12 text-white">{t.createFlowBadge}</Badge>
                    <button
                      type="button"
                      onClick={() => setAiMode(true)}
                      className="text-sm font-medium text-slate-300 underline underline-offset-2 hover:text-white"
                    >
                      {t.createAiBackToAssistant}
                    </button>
                  </div>
                  <div>
                    <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                      {t.createFlowTitle}
                    </h1>
                    <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
                      {t.createFlowDesc}
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-[2rem]">
                <CardHeader>
                  <CardTitle className="font-display text-2xl">{t.createStep1Title}</CardTitle>
                  <CardDescription>{t.createStep1Desc}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {sessionTypes.map((type) => {
                    const active = type.id === sessionType;
                    return (
                      <button
                        key={type.id}
                        type="button"
                        onClick={() => setSessionType(type.id)}
                        className={`rounded-[1.5rem] border p-5 text-left transition-all ${
                          active
                            ? "border-primary bg-soft-purple shadow-sm"
                            : "border-border bg-white hover:-translate-y-0.5 hover:shadow-sm"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-base font-semibold text-text-primary">{type.title}</p>
                            <p className="mt-2 text-sm leading-6 text-text-secondary">{type.copy}</p>
                          </div>
                          {active ? <Check className="h-5 w-5 text-primary" /> : null}
                        </div>
                      </button>
                    );
                  })}
                </CardContent>
              </Card>

          <Card className="rounded-[2rem]">
            <CardHeader>
              <CardTitle className="font-display text-2xl">{t.createStep2Title}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <label className="text-sm font-medium text-text-primary">
                {t.createFieldSessionTitle}
                <input
                  className="mt-2 rounded-2xl border border-border px-4 py-3"
                  value={form.title}
                  onChange={(event) => setForm({ ...form, title: event.target.value })}
                />
              </label>
              <label className="text-sm font-medium text-text-primary">
                {t.createFieldWorkspace}
                <input
                  className="mt-2 rounded-2xl border border-border px-4 py-3"
                  value={form.workspace}
                  onChange={(event) => setForm({ ...form, workspace: event.target.value })}
                />
              </label>
              <label className="md:col-span-2 text-sm font-medium text-text-primary">
                {t.createFieldDescription}
                <textarea
                  rows={4}
                  className="mt-2 rounded-2xl border border-border px-4 py-3"
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                />
              </label>
              <label className="text-sm font-medium text-text-primary">
                {t.createFieldLanguage}
                <div className="mt-2 flex items-center gap-2 rounded-2xl border border-border px-4 py-3">
                  <Globe2 className="h-4 w-4 text-text-secondary" />
                  <input
                    className="border-0 p-0"
                    value={form.language}
                    onChange={(event) => setForm({ ...form, language: event.target.value })}
                  />
                </div>
              </label>
              <label className="text-sm font-medium text-text-primary">
                {t.createFieldDeadline}
                <input
                  className="mt-2 rounded-2xl border border-border px-4 py-3"
                  value={form.deadline}
                  onChange={(event) => setForm({ ...form, deadline: event.target.value })}
                />
              </label>
            </CardContent>
          </Card>

          <Card className="rounded-[2rem]">
            <CardHeader>
              <CardTitle className="font-display text-2xl">{t.createStep3Title}</CardTitle>
              <CardDescription>{t.createStep3Desc}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {t.createParticipationOptions.map(([key, title, copy]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleField(key)}
                  className={`rounded-[1.5rem] border p-4 text-left ${
                    form[key] ? "border-primary bg-soft-purple" : "border-border bg-white"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-text-primary">{title}</p>
                      <p className="mt-2 text-sm leading-6 text-text-secondary">{copy}</p>
                    </div>
                    {form[key] ? <Check className="h-5 w-5 text-primary" /> : null}
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card className="rounded-[2rem]">
            <CardHeader>
              <CardTitle className="font-display text-2xl">{t.createStep4Title}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {votingModes.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setForm({ ...form, voting: mode })}
                  className={`flex items-center justify-between rounded-[1.5rem] border px-4 py-4 text-left ${
                    form.voting === mode ? "border-primary bg-soft-purple" : "border-border bg-white"
                  }`}
                >
                  <span className="text-sm font-medium text-text-primary">{mode}</span>
                  {form.voting === mode ? <Vote className="h-4 w-4 text-primary" /> : <ChevronRight className="h-4 w-4 text-text-secondary" />}
                </button>
              ))}
            </CardContent>
          </Card>

          <Card className="rounded-[2rem]">
            <CardHeader>
              <CardTitle className="font-display text-2xl">{t.createStep5Title}</CardTitle>
              <CardDescription>{t.createStep5Desc}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
              <div className="rounded-[1.75rem] border border-border bg-slate-50 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">{t.createInviteLinkLabel}</p>
                <p className="mt-3 rounded-2xl border border-border bg-white px-4 py-3 text-sm font-medium text-text-primary">
                  {createdSession ? `${window.location.origin}/session/${createdSession.code}` : t.createInviteLinkPending}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    className="rounded-2xl"
                    disabled={!createdSession}
                    onClick={() => navigator.clipboard.writeText(`${window.location.origin}/session/${createdSession.code}`)}
                  >
                    <Copy className="h-4 w-4" />
                    {t.createCopyLink}
                  </Button>
                  <Button variant="secondary" className="rounded-2xl" disabled={!createdSession}>
                    <QrCode className="h-4 w-4" />
                    {t.createQrCode}
                  </Button>
                  <Button variant="secondary" className="rounded-2xl" disabled={!createdSession}>
                    <Mail className="h-4 w-4" />
                    {t.createEmailInvite}
                  </Button>
                </div>
              </div>

              <div className="rounded-[1.75rem] border border-indigo-100 bg-soft-purple p-5">
                <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-sm font-medium text-primary">
                  <LockKeyhole className="h-4 w-4" />
                  {t.createAnonModeOn}
                </div>
                <p className="mt-4 text-sm leading-6 text-indigo-950">
                  {t.createAnonModeDesc}
                </p>
                {createError ? <p className="mt-3 text-sm font-medium text-red-600">{createError}</p> : null}
                <div className="mt-5 grid gap-2">
                  {createdSession ? (
                    <>
                      <Button asChild className="rounded-2xl">
                        <Link to={`/facilitator/${createdSession.code}`}>{t.createOpenFacilitatorRoom}</Link>
                      </Button>
                      <Button asChild variant="secondary" className="rounded-2xl">
                        <Link to={`/session/${createdSession.code}`}>{t.createPreviewParticipantPage}</Link>
                      </Button>
                    </>
                  ) : (
                    <Button className="rounded-2xl" disabled={creating || !form.title.trim()} onClick={() => handleCreateSession()}>
                      {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      {creating ? t.creating : t.createSessionCta}
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
            </>
          )}
        </section>

        <aside className="space-y-5 xl:sticky xl:top-6 xl:self-start">
          <Card className="rounded-[2rem]">
            <CardHeader>
              <CardTitle className="text-lg">{t.createPreviewTitle}</CardTitle>
              <CardDescription>{t.createPreviewDesc}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">{t.createPreviewType}</p>
                <p className="mt-2 text-base font-semibold text-text-primary">{selectedSession.title}</p>
                <p className="mt-1 text-sm leading-6 text-text-secondary">{selectedSession.copy}</p>
              </div>
              <div className="rounded-3xl bg-slate-50 p-4">
                <p className="text-sm font-semibold text-text-primary">{form.title}</p>
                <p className="mt-2 text-sm leading-6 text-text-secondary">{form.description}</p>
              </div>
              <div className="grid gap-2 text-sm text-text-secondary">
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2">
                  <span>{t.createPreviewWorkspace}</span>
                  <span className="font-medium text-text-primary">{form.workspace}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2">
                  <span>{t.createPreviewLanguage}</span>
                  <span className="font-medium text-text-primary">{form.language}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2">
                  <span>{t.createPreviewVoting}</span>
                  <span className="font-medium text-text-primary">{form.voting}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2">
                  <span>{t.createPreviewDeadline}</span>
                  <span className="font-medium text-text-primary">{form.deadline}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] bg-slate-950 text-white">
            <CardHeader>
              <CardTitle className="text-lg text-white">{t.createWhyTitle}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-6 text-slate-300">
              {t.createWhyPoints.map((point) => (
                <p key={point}>{point}</p>
              ))}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function AiSuggestionRow({ label, value, reason, changeCta, onChange }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl bg-slate-50 p-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">{label}</p>
        <p className="mt-1 text-base font-semibold text-text-primary">{value}</p>
        <p className="mt-1 text-sm leading-6 text-text-secondary">{reason}</p>
      </div>
      <Button variant="secondary" className="shrink-0 rounded-xl" onClick={onChange}>
        {changeCta}
      </Button>
    </div>
  );
}
