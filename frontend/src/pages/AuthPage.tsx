import { ArrowRight, CheckCircle2, LockKeyhole, Mail } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { useI18n } from "../i18n.jsx";

type AuthMode = "login" | "register" | "forgot";

type AuthPageProps = {
  mode: AuthMode;
};

export default function AuthPage({ mode }: AuthPageProps) {
  const { t } = useI18n();

  const content: Record<AuthMode, {
    eyebrow: string;
    title: string;
    description: string;
    primary: string;
    secondaryText: string;
    secondaryLink: string;
    secondaryLabel: string;
  }> = {
    login: {
      eyebrow: t.authEyebrowLogin,
      title: t.authTitleLogin,
      description: t.authDescLogin,
      primary: t.authPrimaryLogin,
      secondaryText: t.authSecondaryTextLogin,
      secondaryLink: "/register",
      secondaryLabel: t.authSecondaryLabelLogin,
    },
    register: {
      eyebrow: t.authEyebrowRegister,
      title: t.authTitleRegister,
      description: t.authDescRegister,
      primary: t.authPrimaryRegister,
      secondaryText: t.authSecondaryTextRegister,
      secondaryLink: "/login",
      secondaryLabel: t.authSecondaryLabelRegister,
    },
    forgot: {
      eyebrow: t.authEyebrowForgot,
      title: t.authTitleForgot,
      description: t.authDescForgot,
      primary: t.authPrimaryForgot,
      secondaryText: t.authSecondaryTextForgot,
      secondaryLink: "/login",
      secondaryLabel: t.authSecondaryLabelForgot,
    },
  };

  const view = content[mode];

  return (
    <div className="mx-auto grid min-h-[calc(100vh-8rem)] max-w-[1200px] items-center gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_420px]">
      <section className="rounded-[2.5rem] bg-slate-950 p-8 text-white shadow-[0_28px_80px_rgba(15,23,42,0.28)] sm:p-10">
        <div className="max-w-xl space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/8 px-4 py-2 text-sm text-slate-200">
            <LockKeyhole className="h-4 w-4 text-cyan-300" />
            {view.eyebrow}
          </div>
          <div className="space-y-3">
            <h1 className="font-display text-4xl font-semibold tracking-tight">{view.title}</h1>
            <p className="text-base leading-7 text-slate-300">{view.description}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {t.authTrustCards.map(([title, copy]: [string, string]) => (
              <div key={title} className="rounded-3xl border border-white/10 bg-white/6 p-4">
                <p className="font-semibold">{title}</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Card className="rounded-[2rem]">
        <CardContent className="space-y-5 p-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-text-secondary">{view.eyebrow}</p>
            <h2 className="mt-3 font-display text-2xl font-semibold text-text-primary">{view.primary}</h2>
          </div>

          {mode !== "forgot" ? (
            <label className="text-sm font-medium text-text-primary">
              {t.authWorkEmail}
              <div className="mt-2 flex items-center gap-2 rounded-2xl border border-border px-4 py-3">
                <Mail className="h-4 w-4 text-text-secondary" />
                <input className="border-0 p-0" placeholder="team@company.com" />
              </div>
            </label>
          ) : (
            <label className="text-sm font-medium text-text-primary">
              {t.authEmail}
              <div className="mt-2 flex items-center gap-2 rounded-2xl border border-border px-4 py-3">
                <Mail className="h-4 w-4 text-text-secondary" />
                <input className="border-0 p-0" placeholder="team@company.com" />
              </div>
            </label>
          )}

          {mode !== "forgot" ? (
            <label className="text-sm font-medium text-text-primary">
              {t.authPassword}
              <input type="password" className="mt-2 rounded-2xl border border-border px-4 py-3" placeholder="••••••••" />
            </label>
          ) : null}

          {mode === "register" ? (
            <label className="text-sm font-medium text-text-primary">
              {t.authWorkspaceName}
              <input className="mt-2 rounded-2xl border border-border px-4 py-3" placeholder="GhostTalk Product Team" />
            </label>
          ) : null}

          <Button asChild className="w-full rounded-2xl">
            <Link to="/dashboard">
              {view.primary}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>

          {mode === "login" ? (
            <Link to="/forgot-password" className="block text-sm font-medium text-primary">
              {t.authForgotPassword}
            </Link>
          ) : null}

          <div className="rounded-3xl bg-slate-50 p-4 text-sm leading-6 text-text-secondary">
            <p className="inline-flex items-center gap-2 font-semibold text-text-primary">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              {t.authPrivacyNoteTitle}
            </p>
            <p className="mt-2">
              {t.authPrivacyNoteText}
            </p>
          </div>

          <p className="text-sm text-text-secondary">
            {view.secondaryText}{" "}
            <Link to={view.secondaryLink} className="font-semibold text-primary">
              {view.secondaryLabel}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
