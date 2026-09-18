import { BarChart3, Download, FileText, Sparkles, Users } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { resultHighlights, sessionMock } from "../mock/sessionMock";
import { useI18n } from "../i18n.jsx";

export default function ResultsPage() {
  const { t } = useI18n();
  return (
    <div className="mx-auto w-full max-w-[1380px] px-4 py-6 sm:px-6">
      <div className="grid gap-5">
        <Card className="rounded-[2rem] border-none bg-slate-950 text-white shadow-[0_24px_70px_rgba(15,23,42,0.28)]">
          <CardContent className="grid gap-6 p-8 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-4">
              <Badge className="w-fit bg-white/12 text-white">{t.resultsBadge}</Badge>
              <div>
                <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                  {t.resultsHeroTitle}
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
                  {t.resultsHeroDesc}
                </p>
              </div>
            </div>
            <div className="grid gap-3">
              <div className="rounded-3xl border border-white/10 bg-white/8 p-4">
                <p className="text-sm text-slate-300">{t.resultsParticipantsLabel}</p>
                <p className="mt-2 font-display text-3xl font-semibold">{sessionMock.participantsCount}</p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/8 p-4">
                <p className="text-sm text-slate-300">{t.resultsResponsesLabel}</p>
                <p className="mt-2 font-display text-3xl font-semibold">{sessionMock.responsesCount}</p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/8 p-4">
                <p className="text-sm text-slate-300">{t.resultsTopThemeLabel}</p>
                <p className="mt-2 text-lg font-semibold">{t.resultsTopThemeValue}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="space-y-5">
            <Card className="rounded-[2rem]">
              <CardHeader>
                <CardTitle className="font-display text-2xl">{t.resultsHighlightsTitle}</CardTitle>
                <CardDescription>{t.resultsHighlightsDesc}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {resultHighlights.map((highlight) => (
                  <div key={highlight.title} className={`rounded-[1.5rem] px-5 py-5 ${highlight.accent}`}>
                    <p className="text-base font-semibold">{highlight.title}</p>
                    <p className="mt-2 text-sm leading-6 opacity-90">{highlight.description}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="rounded-[2rem]">
              <CardHeader>
                <CardTitle className="font-display text-2xl">{t.resultsTopIdeasTitle}</CardTitle>
                <CardDescription>{t.resultsTopIdeasDesc}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {sessionMock.columns.flatMap((column) => column.ideas.slice(0, 1)).map((idea, index) => (
                  <div key={idea.id} className="rounded-[1.5rem] border border-border bg-white p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-2">
                        <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">
                          {t.resultsRankLabel} {index + 1}
                        </span>
                        <p className="text-sm leading-6 text-text-primary">{idea.text}</p>
                      </div>
                      <Badge variant="success">{idea.votes} {t.resultsVotesSuffix}</Badge>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="rounded-[2rem]">
              <CardHeader>
                <CardTitle className="font-display text-2xl">{t.resultsGroupedTitle}</CardTitle>
                <CardDescription>{t.resultsGroupedDesc}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 lg:grid-cols-3">
                {t.resultsGroupedThemes.map(([title, copy]: [string, string]) => (
                  <div key={title} className="rounded-[1.5rem] border border-border bg-slate-50 p-4">
                    <p className="font-semibold text-text-primary">{title}</p>
                    <p className="mt-2 text-sm leading-6 text-text-secondary">{copy}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>

          <aside className="space-y-5 xl:sticky xl:top-6 xl:self-start">
            <Card className="rounded-[2rem]">
              <CardHeader>
                <CardTitle className="text-lg">{t.resultsExportTitle}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                <Button variant="secondary" className="justify-between rounded-2xl">
                  {t.resultsExportPdf}
                  <Download className="h-4 w-4" />
                </Button>
                <Button variant="secondary" className="justify-between rounded-2xl">
                  {t.resultsExportCsv}
                  <BarChart3 className="h-4 w-4" />
                </Button>
                <Button variant="secondary" className="justify-between rounded-2xl">
                  {t.resultsExportMd}
                  <FileText className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            <Card className="rounded-[2rem] bg-slate-50">
              <CardHeader>
                <CardTitle className="text-lg">{t.resultsWhyTitle}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm leading-6 text-text-secondary">
                <p className="inline-flex items-center gap-2 font-semibold text-text-primary">
                  <Users className="h-4 w-4 text-primary" />
                  {t.resultsWhyPresentationReady}
                </p>
                <p>{t.resultsWhyPresentationDesc}</p>
                <p className="inline-flex items-center gap-2 font-semibold text-text-primary">
                  <Sparkles className="h-4 w-4 text-primary" />
                  {t.resultsWhySummaryReady}
                </p>
                <p>{t.resultsWhySummaryDesc}</p>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  );
}
