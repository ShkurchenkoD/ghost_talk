import BottomSessionBar from "../components/BottomSessionBar";
import FacilitatorPanel from "../components/FacilitatorPanel";
import IdeaColumn from "../components/IdeaColumn";
import SessionHeader from "../components/SessionHeader";
import SessionStepper from "../components/SessionStepper";
import Sidebar from "../components/Sidebar";
import { sessionMock } from "../mock/sessionMock";

export default function SessionPage() {
  return (
    <div className="mx-auto w-full max-w-[1580px] px-4 py-6 sm:px-6">
      <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)_320px]">
        <Sidebar activeItem="Мої сесії" />

        <section className="space-y-5">
          <SessionHeader
            title={sessionMock.title}
            methodName={sessionMock.methodName}
            participantsCount={sessionMock.participantsCount}
            sessionCode={sessionMock.sessionCode}
          />

          <SessionStepper currentIndex={sessionMock.stageIndex} />

          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {sessionMock.columns.map((column) => (
              <IdeaColumn key={column.id} column={column} />
            ))}
          </div>

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
