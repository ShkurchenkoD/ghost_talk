import { Layers3, Plus, Settings2, Sparkles, Speech, Vote } from "lucide-react";
import { Link } from "react-router-dom";
import { sidebarMethodologies } from "../mock/sessionMock";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { useI18n } from "../i18n.jsx";

type SidebarProps = {
  activeItem: "sessions" | "create" | "results" | "settings";
};

export default function Sidebar({ activeItem }: SidebarProps) {
  const { t } = useI18n();

  const navItems = [
    { id: "sessions", label: t.sidebarNavSessions, icon: Layers3, href: "/dashboard" },
    { id: "create", label: t.sidebarNavCreateFlow, icon: Sparkles, href: "/create" },
    { id: "results", label: t.sidebarNavResults, icon: Vote, href: "/results/demo" },
    { id: "settings", label: t.sidebarNavSettings, icon: Settings2, href: "/settings" },
  ] as const;

  return (
    <aside className="rounded-3xl border border-border bg-card p-4 shadow-soft lg:h-[calc(100vh-3rem)] lg:sticky lg:top-6">
      <div className="flex items-center gap-2 px-2 pb-6 pt-2">
        <span className="rounded-2xl bg-primary p-2 text-white">
          <Speech className="h-4 w-4" />
        </span>
        <div>
          <p className="font-display text-lg font-semibold leading-tight text-text-primary">GhostTalk</p>
          <p className="text-xs text-text-secondary">{t.sidebarTagline}</p>
        </div>
      </div>

      <Button asChild className="mb-5 w-full justify-center rounded-2xl">
        <Link to="/create">
        <Plus className="h-4 w-4" />
        {t.sidebarCreateSession}
        </Link>
      </Button>

      <nav className="space-y-1.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === activeItem;

          return (
            <Link
              key={item.href}
              to={item.href}
              className={cn(
                "flex items-center gap-2 rounded-2xl px-3 py-2 text-sm transition-colors",
                isActive ? "bg-soft-purple text-primary" : "text-text-secondary hover:bg-slate-50",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-6 rounded-2xl border border-border bg-slate-50 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">{t.sidebarPopularFormats}</p>
        <ul className="space-y-1.5 text-sm text-text-primary">
          {sidebarMethodologies.map((method) => (
            <li key={method} className="rounded-xl px-2 py-1.5 hover:bg-white">
              {method}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
