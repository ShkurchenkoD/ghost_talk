import { ArrowRight, CheckCircle2, Flag, Gauge, Lightbulb } from "lucide-react";
import ParticipantAvatars from "./ParticipantAvatars";
import TimerCard from "./TimerCard";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Progress } from "./ui/progress";
import { useI18n } from "../i18n.jsx";

type FacilitatorPanelProps = {
  currentStage: string;
  progress: number;
  timer: string;
  participants: string[];
};

export default function FacilitatorPanel({
  currentStage,
  progress,
  timer,
  participants,
}: FacilitatorPanelProps) {
  const { t } = useI18n();
  return (
    <aside className="space-y-4 xl:sticky xl:top-6">
      <Card className="rounded-3xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t.facilitatorControlsTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Badge variant="success" className="w-fit gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t.facilitatorSessionActive}
            </Badge>
            <div className="text-sm text-text-secondary">
              {t.facilitatorCurrentStage}: <span className="font-semibold text-text-primary">{currentStage}</span>
            </div>
            <Progress value={progress} />
          </div>

          <TimerCard timeLabel={timer} progress={progress} />

          <div className="space-y-2">
            <p className="text-sm font-medium text-text-primary">{t.facilitatorParticipantsOnline}</p>
            <ParticipantAvatars participants={participants} />
          </div>

          <div className="grid gap-2">
            <Button className="justify-between rounded-2xl">
              {t.facilitatorFinishStage}
              <Flag className="h-4 w-4" />
            </Button>
            <Button variant="secondary" className="justify-between rounded-2xl">
              {t.facilitatorMoveClustering}
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button variant="secondary" className="justify-between rounded-2xl border-rose-200 text-rose-700 hover:bg-rose-50">
              {t.facilitatorEndSession}
              <Gauge className="h-4 w-4" />
            </Button>
          </div>

          <div className="rounded-2xl border border-indigo-100 bg-soft-purple p-4">
            <p className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-primary">
              <Lightbulb className="h-4 w-4" />
              {t.facilitatorNoteLabel}
            </p>
            <p className="text-sm text-indigo-900/90">
              {t.facilitatorNoteText}
            </p>
          </div>
        </CardContent>
      </Card>
    </aside>
  );
}
