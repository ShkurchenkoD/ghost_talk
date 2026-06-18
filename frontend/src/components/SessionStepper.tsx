import { cn } from "../lib/utils";

const stages = ["Інструкція", "Збір ідей", "Групування", "Голосування", "Підсумок"];

type SessionStepperProps = {
  currentIndex: number;
};

export default function SessionStepper({ currentIndex }: SessionStepperProps) {
  return (
    <div className="rounded-3xl border border-border bg-card p-5 shadow-soft">
      <ol className="grid gap-3 md:grid-cols-5 md:gap-4">
        {stages.map((label, index) => {
          const isDone = index < currentIndex;
          const isCurrent = index === currentIndex;

          return (
            <li key={label} className="relative">
              <div
                className={cn(
                  "rounded-2xl border px-3 py-3 text-sm",
                  isCurrent && "border-primary bg-soft-purple text-primary",
                  isDone && "border-emerald-200 bg-soft-green text-emerald-700",
                  !isCurrent && !isDone && "border-border bg-white text-text-secondary",
                )}
              >
                <p className="text-xs font-semibold">Крок {index + 1}</p>
                <p className="mt-1 font-semibold">{label}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
