import { ChevronRight, FilePlus2 } from "lucide-react";
import Sidebar from "../components/Sidebar";
import { dashboardSessions, quickTemplates } from "../mock/sessionMock";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";

function statusBadgeVariant(status: "active" | "draft" | "completed") {
  if (status === "active") return "success" as const;
  if (status === "draft") return "warning" as const;
  return "outline" as const;
}

function statusLabel(status: "active" | "draft" | "completed") {
  if (status === "active") return "active";
  if (status === "draft") return "draft";
  return "completed";
}

export default function DashboardPage() {
  return (
    <div className="mx-auto w-full max-w-[1520px] px-4 py-6 sm:px-6">
      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Sidebar activeItem="Мої сесії" />

        <section className="space-y-5">
          <Card className="rounded-3xl">
            <CardHeader>
              <CardTitle className="font-display text-2xl">Мої сесії</CardTitle>
              <CardDescription>
                Платформа для структурованих анонімних обговорень, голосування та прийняття рішень.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {dashboardSessions.map((session) => (
                <div
                  key={session.title}
                  className="rounded-2xl border border-border bg-white p-4 transition-colors hover:bg-slate-50"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-text-primary">{session.title}</p>
                      <p className="text-sm text-text-secondary">
                        {session.method} · {session.participants} учасників
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={statusBadgeVariant(session.status)}>{statusLabel(session.status)}</Badge>
                      <Button variant="ghost" size="icon" aria-label="Відкрити сесію">
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-text-secondary">{session.updatedAt}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="rounded-3xl">
            <CardHeader>
              <CardTitle className="text-lg">Швидкий доступ до шаблонів методик</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              {quickTemplates.map((template) => (
                <button
                  key={template}
                  className="flex items-center justify-between rounded-2xl border border-border bg-slate-50 px-4 py-3 text-left text-sm font-medium text-text-primary transition-colors hover:bg-white"
                >
                  {template}
                  <FilePlus2 className="h-4 w-4 text-text-secondary" />
                </button>
              ))}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
