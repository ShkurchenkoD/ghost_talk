import { Avatar } from "./ui/avatar";

type ParticipantAvatarsProps = {
  participants: string[];
};

export default function ParticipantAvatars({ participants }: ParticipantAvatarsProps) {
  const visible = participants.slice(0, 6);
  const hiddenCount = Math.max(0, participants.length - visible.length);

  return (
    <div className="flex items-center">
      {visible.map((initials, index) => (
        <Avatar
          key={`${initials}-${index}`}
          initials={initials}
          className={index > 0 ? "-ml-2" : ""}
        />
      ))}
      {hiddenCount > 0 && (
        <div className="-ml-2 flex h-9 w-9 items-center justify-center rounded-full border border-white bg-slate-200 text-xs font-semibold text-slate-700">
          +{hiddenCount}
        </div>
      )}
    </div>
  );
}
