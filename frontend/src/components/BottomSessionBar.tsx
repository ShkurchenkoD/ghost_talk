import { Copy, Lock, UserPlus } from "lucide-react";
import { Button } from "./ui/button";
import { useI18n } from "../i18n.jsx";

type BottomSessionBarProps = {
  sessionCode: string;
};

export default function BottomSessionBar({ sessionCode }: BottomSessionBarProps) {
  const { t } = useI18n();
  return (
    <div className="sticky bottom-4 z-30 mt-6">
      <div className="rounded-3xl border border-border bg-card/95 px-4 py-3 shadow-soft backdrop-blur sm:px-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 rounded-full bg-soft-green p-2 text-emerald-700">
              <Lock className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-text-primary">{t.bottomBarAnonTitle}</p>
              <p className="text-xs text-text-secondary">{t.bottomBarAnonDesc}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" className="rounded-2xl">
              <UserPlus className="h-4 w-4" />
              {t.bottomBarJoinParticipant}
            </Button>
            <div className="rounded-2xl border border-border bg-slate-50 px-3 py-2 text-sm font-semibold tracking-[0.14em] text-text-primary">
              {sessionCode}
            </div>
            <Button variant="secondary" size="icon" className="rounded-2xl" aria-label={t.bottomBarCopyCode}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
