import { CheckCircle2, LockKeyhole, MessageSquareText, TimerReset, Vote } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { participantIdeas, participantInsights } from "../mock/sessionMock";
import { useI18n } from "../i18n.jsx";

export default function ParticipantDemoPage() {
  const { t } = useI18n();
  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 py-6 sm:px-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="space-y-5">
          <Card className="rounded-[2rem] border-none bg-slate-950 text-white shadow-[0_24px_70px_rgba(15,23,42,0.28)]">
            <CardContent className="space-y-4 p-8">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full bg-emerald-400/15 px-3 py-1 text-sm text-emerald-300">
                  <LockKeyhole className="h-4 w-4" />
                  {t.participantAnonOn}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm text-slate-200">
                  {t.participantGuestAccess}
                </span>
              </div>
              <div>
                <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                  {t.participantHeroTitle}
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
                  {t.participantHeroDesc}
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
            <Card className="rounded-[2rem]">
              <CardHeader>
                <CardTitle className="font-display text-2xl">{t.participantLeaveResponseTitle}</CardTitle>
                <CardDescription>
                  {t.participantLeaveResponseDesc}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <label className="text-sm font-medium text-text-primary">
                  {t.participantFieldLabel}
                  <textarea
                    rows={6}
                    className="mt-2 rounded-2xl border border-border px-4 py-3"
                    defaultValue="A short explainer before the first session would help people understand why their feedback is anonymous and how it will be used."
                  />
                </label>
                <div className="flex flex-wrap gap-3">
                  <Button className="rounded-2xl">{t.participantSubmit}</Button>
                  <Button variant="secondary" className="rounded-2xl">{t.participantSaveDraft}</Button>
                </div>
                <div className="rounded-3xl border border-emerald-100 bg-soft-green p-4 text-sm leading-6 text-emerald-900">
                  <p className="inline-flex items-center gap-2 font-semibold">
                    <CheckCircle2 className="h-4 w-4" />
                    {t.participantSavedTitle}
                  </p>
                  <p className="mt-2">{t.participantSavedDesc}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[2rem]">
              <CardHeader>
                <CardTitle className="text-lg">{t.participantNeedToKnowTitle}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {participantInsights.map((item) => (
                  <div key={item.label} className="rounded-3xl bg-slate-50 px-4 py-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">{item.label}</p>
                    <p className="mt-2 text-sm font-semibold text-text-primary">{item.value}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card className="rounded-[2rem]">
            <CardHeader>
              <CardTitle className="font-display text-2xl">{t.participantVisibleIdeasTitle}</CardTitle>
              <CardDescription>
                {t.participantVisibleIdeasDesc}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {participantIdeas.map((idea) => (
                <div key={idea.id} className="rounded-[1.5rem] border border-border bg-white p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-2">
                      <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">
                        {idea.tag}
                      </span>
                      <p className="text-sm leading-6 text-text-primary">{idea.text}</p>
                    </div>
                    <Button variant="secondary" className="rounded-2xl">
                      <Vote className="h-4 w-4" />
                      {idea.votes} {t.participantVotesSuffix}
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
          <Card className="rounded-[2rem]">
            <CardHeader>
              <CardTitle className="text-lg">{t.participantTrustStackTitle}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-6 text-text-secondary">
              <div className="rounded-3xl bg-slate-50 p-4">
                <p className="inline-flex items-center gap-2 font-semibold text-text-primary">
                  <LockKeyhole className="h-4 w-4 text-primary" />
                  {t.participantAnonIdentityTitle}
                </p>
                <p className="mt-2">{t.participantAnonIdentityDesc}</p>
              </div>
              <div className="rounded-3xl bg-slate-50 p-4">
                <p className="inline-flex items-center gap-2 font-semibold text-text-primary">
                  <TimerReset className="h-4 w-4 text-primary" />
                  {t.participantShortTaskTitle}
                </p>
                <p className="mt-2">{t.participantShortTaskDesc}</p>
              </div>
              <div className="rounded-3xl bg-slate-50 p-4">
                <p className="inline-flex items-center gap-2 font-semibold text-text-primary">
                  <MessageSquareText className="h-4 w-4 text-primary" />
                  {t.participantClearOutcomeTitle}
                </p>
                <p className="mt-2">{t.participantClearOutcomeDesc}</p>
              </div>
            </CardContent>
          </Card>

          <Button asChild className="w-full rounded-2xl">
            <Link to="/results/demo">{t.participantPreviewResults}</Link>
          </Button>
        </aside>
      </div>
    </div>
  );
}
