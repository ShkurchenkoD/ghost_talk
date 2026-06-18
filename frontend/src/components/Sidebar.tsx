import { Archive, BarChart3, FolderKanban, Layers3, Plus, Speech } from "lucide-react";
import { Link } from "react-router-dom";
import { sidebarMethodologies } from "../mock/sessionMock";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

const navItems = [
  { label: "Мої сесії", icon: Layers3, href: "/" },
  { label: "Шаблони методик", icon: FolderKanban, href: "/" },
  { label: "Архів", icon: Archive, href: "/" },
  { label: "Аналітика", icon: BarChart3, href: "/" },
];

type SidebarProps = {
  activeItem: string;
};

export default function Sidebar({ activeItem }: SidebarProps) {
  return (
    <aside className="rounded-3xl border border-border bg-card p-4 shadow-soft lg:h-[calc(100vh-3rem)] lg:sticky lg:top-6">
      <div className="flex items-center gap-2 px-2 pb-6 pt-2">
        <span className="rounded-2xl bg-primary p-2 text-white">
          <Speech className="h-4 w-4" />
        </span>
        <div>
          <p className="font-display text-lg font-semibold leading-tight text-text-primary">GhostTalk</p>
          <p className="text-xs text-text-secondary">Структуровані сесії</p>
        </div>
      </div>

      <Button className="mb-5 w-full justify-center rounded-2xl">
        <Plus className="h-4 w-4" />
        Створити сесію
      </Button>

      <nav className="space-y-1.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.label === activeItem;

          return (
            <Link
              key={item.label}
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
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Методики</p>
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
