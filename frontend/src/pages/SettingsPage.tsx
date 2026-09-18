import { Bell, Globe2, ShieldCheck, Users } from "lucide-react";
import Sidebar from "../components/Sidebar";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { settingsSections } from "../mock/sessionMock";
import { useI18n } from "../i18n.jsx";

const profileIcons: Record<string, typeof Users> = { roles: Users, language: Globe2, notifications: Bell, privacy: ShieldCheck };

export default function SettingsPage() {
  const { t } = useI18n();
  return (
    <div className="mx-auto w-full max-w-[1520px] px-4 py-6 sm:px-6">
      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Sidebar activeItem="settings" />

        <section className="space-y-5">
          <Card className="rounded-[2rem] border-none bg-slate-950 text-white shadow-[0_24px_70px_rgba(15,23,42,0.28)]">
            <CardContent className="space-y-3 p-8">
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-300">{t.settingsBadge}</p>
              <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                {t.settingsHeroTitle}
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
                {t.settingsHeroDesc}
              </p>
            </CardContent>
          </Card>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-5">
              {settingsSections.map((section) => (
                <Card key={section.title} className="rounded-[2rem]">
                  <CardHeader>
                    <CardTitle className="font-display text-2xl">{section.title}</CardTitle>
                    <CardDescription>{section.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-4 md:grid-cols-2">
                    <label className="text-sm font-medium text-text-primary">
                      {t.settingsPrimaryValue}
                      <input className="mt-2 rounded-2xl border border-border px-4 py-3" defaultValue={section.title} />
                    </label>
                    <label className="text-sm font-medium text-text-primary">
                      {t.settingsSupportingValue}
                      <input className="mt-2 rounded-2xl border border-border px-4 py-3" defaultValue="Configured" />
                    </label>
                  </CardContent>
                </Card>
              ))}
            </div>

            <aside className="space-y-5 xl:sticky xl:top-6 xl:self-start">
              <Card className="rounded-[2rem]">
                <CardHeader>
                  <CardTitle className="text-lg">{t.settingsProfileTitle}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {t.settingsProfileItems.map(([key, title, copy]: [string, string, string]) => {
                    const Icon = profileIcons[key];
                    return (
                      <div key={key} className="rounded-3xl bg-slate-50 p-4">
                        <p className="inline-flex items-center gap-2 text-sm font-semibold text-text-primary">
                          <Icon className="h-4 w-4 text-primary" />
                          {title}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-text-secondary">{copy}</p>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              <Button className="w-full rounded-2xl">{t.settingsSave}</Button>
            </aside>
          </div>
        </section>
      </div>
    </div>
  );
}
