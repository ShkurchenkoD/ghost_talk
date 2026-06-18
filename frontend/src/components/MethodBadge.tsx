import { Sparkles } from "lucide-react";
import { Badge } from "./ui/badge";

type MethodBadgeProps = {
  methodName: string;
};

export default function MethodBadge({ methodName }: MethodBadgeProps) {
  return (
    <Badge className="gap-1.5 bg-soft-purple text-primary">
      <Sparkles className="h-3.5 w-3.5" />
      {methodName}
    </Badge>
  );
}
