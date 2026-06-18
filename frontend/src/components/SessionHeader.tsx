import { Copy, Link2, ShieldCheck, Users } from "lucide-react";
import MethodBadge from "./MethodBadge";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";

type SessionHeaderProps = {
  title: string;
  methodName: string;
  participantsCount: number;
  sessionCode: string;
};

export default function SessionHeader({
  title,
  methodName,
  participantsCount,
  sessionCode,
}: SessionHeaderProps) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-6 p-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">Сесія GhostTalk</p>
          <h1 className="text-2xl font-display font-semibold tracking-tight text-text-primary sm:text-3xl">{title}</h1>
          <div className="flex flex-wrap items-center gap-2.5">
            <MethodBadge methodName={methodName} />
            <Badge variant="outline" className="gap-1.5 text-text-secondary">
              <Users className="h-3.5 w-3.5" />
              {participantsCount} учасників
            </Badge>
            <Badge variant="success" className="gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" />
              Анонімна сесія
            </Badge>
          </div>
        </div>
        <div className="flex flex-col gap-2.5 sm:flex-row lg:flex-col lg:items-end">
          <Button variant="secondary" className="rounded-2xl border-border px-4">
            <Link2 className="h-4 w-4" />
            Посилання для учасників
          </Button>
          <Button variant="ghost" className="rounded-2xl text-text-secondary">
            Код: {sessionCode}
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
