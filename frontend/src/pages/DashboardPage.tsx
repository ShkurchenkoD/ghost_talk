import { ArrowRight, Copy, FilePlus2, FolderSync, Users } from "lucide-react";
import { Link } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import { dashboardMetrics, dashboardSessions, quickTemplates } from "../mock/sessionMock";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { SessionStatus } from "../types/session";
import { useI18n } from "../i18n.jsx";

export default function DashboardPage() {
  const { t } = useI18n();

  function statusBadgeVariant(status: SessionStatus) {
    if (status === "active") return "success" as const;
    if (status === "draft") return "warning" as const;
    if (status === "voting") return "default" as const;
    return "outline" as const;
  }

  function statusLabel(status: SessionStatus) {
    if (status === "active") return t.dashboardStatusActive;
    if (status === "draft") return t.dashboardStatusDraft;
    if (status === "voting") return t.dashboardStatusVoting;
    if (status === "archived") return t.dashboardStatusArchived;
    return t.dashboardStatusFinished;
  }

  return (
    <div className="mx-auto w-full max-w-[1520px] px-4 py-6 sm:px-6">
      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Sidebar activeItem="sessions" />

        <section className="space-y-5">
          <Card className="overflow-hidden rounded-[2rem] border-none bg-slate-950 text-white shadow-[0_30px_80px_rgba(15,23,42,0.32)]">
            <CardContent className="grid gap-8 p-8 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-5">
                <Badge className="w-fit bg-white/12 text-white">{t.dashboardBadge}</Badge>
                <div className="space-y-3">
                  <h1 className="max-w-2xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                    {t.dashboardHeroTitle}
                  </h1>
                  <p className="max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                    {t.dashboardHeroDesc}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button asChild className="rounded-2xl bg-white text-slate-950 hover:bg-slate-100">
                    <Link to="/create">{t.dashboardCreateSession}</Link>
                  </Button>
                  <Button asChild variant="ghost" className="rounded-2xl border border-white/15 text-white hover:bg-white/10">
                    <Link to="/live/demo">{t.dashboardOpenFacilitatorView}</Link>
                  </Button>
                </div>
              </div>

              <div className="grid gap-3">
                {dashboardMetrics.map((metric) => (
                  <div key={metric.label} className="rounded-3xl border border-white/10 bg-white/8 p-5">
                    <p className="text-sm text-slate-300">{metric.label}</p>
                    <p className="mt-2 font-display text-3xl font-semibold">{metric.value}</p>
                    <p className="mt-1 text-sm text-emerald-300">{metric.trend}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Card className="rounded-3xl">
              <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                  <CardTitle className="font-display text-2xl">{t.dashboardRecentSessionsTitle}</CardTitle>
                  <CardDescription>
                    {t.dashboardRecentSessionsDesc}
                  </CardDescription>
                </div>
                <Button asChild variant="secondary" className="rounded-2xl">
                  <Link to="/participant/demo">{t.dashboardPreviewParticipantFlow}</Link>
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {dashboardSessions.map((session) => (
                  <div
                    key={session.id}
                    className="rounded-[1.5rem] border border-border bg-white p-5 transition-all hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={statusBadgeVariant(session.status)}>{statusLabel(session.status)}</Badge>
                          <span className="text-xs font-medium uppercase tracking-[0.14em] text-text-secondary">
                            {session.method}
                          </span>
                        </div>
                        <div>
                          <p className="text-base font-semibold text-text-primary">{session.title}</p>
                          <p className="mt-1 text-sm text-text-secondary">{session.visibility}</p>
                        </div>
                      </div>

                      <div className="grid gap-2 text-sm text-text-secondary sm:grid-cols-3 lg:min-w-[360px]">
                        <div className="rounded-2xl bg-slate-50 px-3 py-2">
                          <p className="text-xs uppercase tracking-[0.12em]">{t.dashboardParticipants}</p>
                          <p className="mt-1 font-semibold text-text-primary">{session.participants}</p>
                        </div>
                        <div className="rounded-2xl bg-slate-50 px-3 py-2">
                          <p className="text-xs uppercase tracking-[0.12em]">{t.dashboardResponses}</p>
                          <p className="mt-1 font-semibold text-text-primary">{session.responses}</p>
                        </div>
                        <div className="rounded-2xl bg-slate-50 px-3 py-2">
                          <p className="text-xs uppercase tracking-[0.12em]">{t.dashboardCreated}</p>
                          <p className="mt-1 font-semibold text-text-primary">{session.createdAt}</p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm text-text-secondary">{session.updatedAt}</p>
                      <div className="flex flex-wrap gap-2">
                        <Button asChild variant="secondary" className="rounded-2xl">
                          <Link to="/live/demo">{t.dashboardOpen}</Link>
                        </Button>
                        <Button variant="secondary" className="rounded-2xl">
                          <Copy className="h-4 w-4" />
                          {t.dashboardCopyInviteLink}
                        </Button>
                        <Button variant="ghost" className="rounded-2xl text-text-secondary">
                          <FolderSync className="h-4 w-4" />
                          {t.dashboardDuplicate}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <div className="space-y-5">
              <Card className="rounded-3xl">
                <CardHeader>
                  <CardTitle className="text-lg">{t.dashboardQuickTemplatesTitle}</CardTitle>
                  <CardDescription>
                    {t.dashboardQuickTemplatesDesc}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  {quickTemplates.map((template) => (
                    <button
                      key={template.id}
                      className="flex items-start justify-between rounded-[1.5rem] border border-border bg-slate-50 px-4 py-4 text-left transition-colors hover:bg-white"
                    >
                      <div>
                        <p className="text-sm font-semibold text-text-primary">{template.title}</p>
                        <p className="mt-1 text-sm leading-5 text-text-secondary">{template.description}</p>
                        <p className="mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-primary">
                          {template.duration}
                        </p>
                      </div>
                      <FilePlus2 className="mt-0.5 h-4 w-4 text-text-secondary" />
                    </button>
                  ))}
                </CardContent>
              </Card>

              <Card className="rounded-3xl">
                <CardHeader>
                  <CardTitle className="text-lg">{t.dashboardEmptyStateTitle}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="rounded-[1.75rem] border border-dashed border-border bg-slate-50 p-6 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm">
                      <Users className="h-5 w-5 text-primary" />
                    </div>
                    <p className="mt-4 text-base font-semibold text-text-primary">{t.dashboardNoSessionsTitle}</p>
                    <p className="mt-2 text-sm leading-6 text-text-secondary">
                      {t.dashboardNoSessionsDesc}
                    </p>
                    <Button asChild className="mt-5 rounded-2xl">
                      <Link to="/create">
                        {t.dashboardStartFromTemplate}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
