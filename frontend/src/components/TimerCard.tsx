import { Clock3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Progress } from "./ui/progress";
import { useI18n } from "../i18n.jsx";

type TimerCardProps = {
  timeLabel: string;
  progress: number;
};

export default function TimerCard({ timeLabel, progress }: TimerCardProps) {
  const { t } = useI18n();
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-text-secondary">
          <Clock3 className="h-4 w-4" />
          {t.timerStageLabel}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-3xl font-display font-semibold text-text-primary">{timeLabel}</div>
        <Progress value={progress} />
      </CardContent>
    </Card>
  );
}
