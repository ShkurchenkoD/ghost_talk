import BottomSessionBar from "../components/BottomSessionBar";
import FacilitatorPanel from "../components/FacilitatorPanel";
import IdeaColumn from "../components/IdeaColumn";
import SessionHeader from "../components/SessionHeader";
import SessionStepper from "../components/SessionStepper";
import Sidebar from "../components/Sidebar";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { sessionMock } from "../mock/sessionMock";
import { useI18n } from "../i18n.jsx";

export default function SessionPage() {
  const { t } = useI18n();
  return (
    <div className="mx-auto w-full max-w-[1580px] px-4 py-6 sm:px-6">
      <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)_320px]">
        <Sidebar activeItem="sessions" />

        <section className="space-y-5">
          <SessionHeader
            title={sessionMock.title}
            methodName={sessionMock.methodName}
            participantsCount={sessionMock.participantsCount}
            sessionCode={sessionMock.sessionCode}
          />

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Card className="rounded-3xl">
              <CardContent className="flex flex-wrap items-center gap-3 p-5">
                <Badge variant="success">{t.sessionLiveNow}</Badge>
                <Badge variant="outline">{sessionMock.responsesCount} {t.sessionResponsesSuffix}</Badge>
                <Badge variant="outline">{sessionMock.participantsCount} {t.sessionParticipantsJoinedSuffix}</Badge>
                <p className="text-sm text-text-secondary">
                  {t.sessionFacilitatorLabel}: <span className="font-semibold text-text-primary">{sessionMock.facilitatorName}</span>
                </p>
              </CardContent>
            </Card>

            <Card className="rounded-3xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t.sessionRealtimeActivity}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {sessionMock.activityFeed.map((item) => (
                  <div key={item} className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-text-secondary">
                    {item}
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <SessionStepper currentIndex={sessionMock.stageIndex} />

          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {sessionMock.columns.map((column) => (
              <IdeaColumn key={column.id} column={column} />
            ))}
          </div>

          <Card className="rounded-3xl border-indigo-100 bg-soft-purple">
            <CardContent className="p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">{t.sessionNextBestAction}</p>
              <p className="mt-2 text-sm leading-6 text-indigo-950">{sessionMock.nextStepHint}</p>
            </CardContent>
          </Card>

          <BottomSessionBar sessionCode={sessionMock.sessionCode} />
        </section>

        <FacilitatorPanel
          currentStage={sessionMock.currentStage}
          progress={sessionMock.stageProgress}
          timer={sessionMock.timer}
          participants={sessionMock.participantInitials}
        />
      </div>
    </div>
  );
}
