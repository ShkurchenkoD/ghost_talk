import {
  ArrowRight,
  CheckCircle2,
  Layers3,
  LockKeyhole,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  Vote,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { useI18n } from "../i18n.jsx";

export default function LandingPage() {
  const { t } = useI18n();

  return (
    <div className="space-y-8 pb-12">
      <section className="overflow-hidden rounded-[2.5rem] bg-slate-950 text-white shadow-[0_32px_100px_rgba(15,23,42,0.28)]">
        <div className="grid gap-10 px-6 py-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:px-12 lg:py-14">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/8 px-4 py-2 text-sm text-slate-200">
              <ShieldCheck className="h-4 w-4 text-emerald-300" />
              {t.landingBadge}
            </div>
            <div className="space-y-4">
              <h1 className="max-w-3xl font-display text-4xl font-semibold tracking-tight sm:text-5xl">
                {t.landingHeroTitle}
              </h1>
              <p className="max-w-2xl text-base leading-7 text-slate-300">
                {t.landingHeroText}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild className="rounded-2xl bg-white text-slate-950 hover:bg-slate-100">
                <Link to="/create">{t.landingCtaCreate}</Link>
              </Button>
              <Button asChild variant="ghost" className="rounded-2xl border border-white/15 text-white hover:bg-white/10">
                <Link to="/dashboard">{t.landingCtaDemo}</Link>
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {t.landingFeatureCards.map(([title, copy]) => (
                <div key={title} className="rounded-3xl border border-white/10 bg-white/6 p-4">
                  <p className="font-semibold">{title}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">{copy}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-0 rounded-[2rem] bg-[radial-gradient(circle_at_top,#38bdf8_0,transparent_42%),radial-gradient(circle_at_80%_80%,#818cf8_0,transparent_38%)] opacity-80" />
            <div className="relative grid gap-4 rounded-[2rem] border border-white/10 bg-slate-900/90 p-5 backdrop-blur">
              <div className="flex items-center justify-between rounded-3xl border border-white/10 bg-white/5 p-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-400">{t.landingLiveLabel}</p>
                  <p className="mt-2 font-display text-2xl font-semibold">{t.landingLiveTitle}</p>
                </div>
                <div className="rounded-full bg-emerald-400/15 px-3 py-1 text-sm text-emerald-300">{t.landingLiveActive}</div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-3xl bg-white p-4 text-slate-950">
                  <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                    <MessageSquareText className="h-4 w-4" />
                    {t.landingNewIdeasTitle}
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    {t.landingNewIdeasQuote}
                  </p>
                  <p className="mt-3 text-xs uppercase tracking-[0.14em] text-slate-400">{t.landingSubmittedAgo}</p>
                </div>
                <div className="rounded-3xl bg-white p-4 text-slate-950">
                  <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                    <Vote className="h-4 w-4" />
                    {t.landingVotingReadyTitle}
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    {t.landingVotingReadyQuote}
                  </p>
                  <p className="mt-3 text-xs uppercase tracking-[0.14em] text-slate-400">{t.landingParticipantsOnline}</p>
                </div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">{t.landingAnonOnTitle}</p>
                    <p className="mt-1 text-sm text-slate-300">{t.landingAnonOnCopy}</p>
                  </div>
                  <LockKeyhole className="h-5 w-5 text-cyan-300" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="rounded-[2rem]">
          <CardHeader>
            <CardTitle className="font-display text-2xl">{t.landingProblemTitle}</CardTitle>
            <CardDescription>{t.landingProblemDesc}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {t.landingProblems.map((problem) => (
              <div key={problem} className="rounded-3xl bg-slate-50 px-4 py-4 text-sm leading-6 text-text-secondary">
                {problem}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-[2rem] border-none bg-gradient-to-br from-cyan-50 via-white to-indigo-50">
          <CardHeader>
            <CardTitle className="font-display text-2xl">{t.landingSolutionTitle}</CardTitle>
            <CardDescription>{t.landingSolutionDesc}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {t.landingSolutionCards.map(([title, copy]) => (
              <div key={title} className="rounded-3xl border border-white bg-white/80 p-4 shadow-sm">
                <p className="font-semibold text-text-primary">{title}</p>
                <p className="mt-2 text-sm leading-6 text-text-secondary">{copy}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section id="how-it-works" className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card className="rounded-[2rem]">
          <CardHeader>
            <CardTitle className="font-display text-2xl">{t.landingHowTitle}</CardTitle>
            <CardDescription>{t.landingHowDesc}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {t.landingSteps.map((step, index) => (
              <div key={step} className="flex gap-4 rounded-3xl border border-border bg-white p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-soft-purple font-semibold text-primary">
                  {index + 1}
                </div>
                <p className="pt-1 text-sm leading-6 text-text-secondary">{step}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-[2rem] bg-slate-50">
          <CardHeader>
            <CardTitle className="font-display text-2xl">{t.landingUseCasesTitle}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            {t.landingUseCases.map((item) => (
              <div key={item} className="rounded-3xl border border-white bg-white px-4 py-4 text-sm font-medium text-text-primary shadow-sm">
                {item}
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section id="features" className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card id="pricing" className="rounded-[2rem]">
          <CardHeader>
            <CardTitle className="font-display text-2xl">{t.landingFeaturesTitle}</CardTitle>
            <CardDescription>{t.landingFeaturesDesc}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {t.landingFeaturesList.map((feature) => (
              <div key={feature} className="flex items-center gap-3 rounded-3xl border border-border bg-slate-50 px-4 py-4">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <span className="text-sm font-medium text-text-primary">{feature}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-[2rem]">
          <CardHeader>
            <CardTitle className="font-display text-2xl">{t.landingPricingTitle}</CardTitle>
            <CardDescription>{t.landingPricingDesc}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {t.landingPricingTiers.map((tier) => (
              <div key={tier.name} className="flex items-center justify-between rounded-3xl border border-border bg-white p-4">
                <div>
                  <p className="font-semibold text-text-primary">{tier.name}</p>
                  <p className="mt-1 text-sm text-text-secondary">{tier.note}</p>
                </div>
                <p className="font-display text-2xl font-semibold text-text-primary">{tier.price}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="rounded-[2.25rem] bg-gradient-to-r from-cyan-500 via-sky-500 to-indigo-500 px-6 py-8 text-white shadow-[0_24px_70px_rgba(14,116,144,0.28)] sm:px-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-cyan-100">
              <Sparkles className="h-4 w-4" />
              {t.landingCtaFinalLabel}
            </p>
            <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight">{t.landingCtaFinalTitle}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-cyan-50">
              {t.landingCtaFinalDesc}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild className="rounded-2xl bg-white text-sky-900 hover:bg-slate-100">
              <Link to="/create">
                {t.landingCtaFinalStart}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="ghost" className="rounded-2xl border border-white/20 text-white hover:bg-white/10">
              <Link to="/login">
                {t.landingCtaFinalWorkspace}
                <Layers3 className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
