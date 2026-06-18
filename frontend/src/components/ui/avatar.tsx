import { cn } from "../../lib/utils";

type AvatarProps = {
  initials: string;
  className?: string;
};

export function Avatar({ initials, className }: AvatarProps) {
  return (
    <div
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-full border border-white bg-soft-purple text-xs font-semibold text-primary shadow-sm",
        className,
      )}
      aria-label={initials}
    >
      {initials}
    </div>
  );
}
