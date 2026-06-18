import { MessageCircle, MoreHorizontal, ThumbsUp } from "lucide-react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

type IdeaCardProps = {
  text: string;
  votes: number;
  comments: number;
};

export default function IdeaCard({ text, votes, comments }: IdeaCardProps) {
  return (
    <Card className="group rounded-2xl border-border p-4 transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm leading-relaxed text-text-primary">{text}</p>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-text-secondary opacity-70 group-hover:opacity-100">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </div>
      <div className="mt-4 flex items-center gap-3 text-xs text-text-secondary">
        <span className="inline-flex items-center gap-1.5">
          <ThumbsUp className="h-3.5 w-3.5" />
          {votes}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <MessageCircle className="h-3.5 w-3.5" />
          {comments}
        </span>
      </div>
    </Card>
  );
}
