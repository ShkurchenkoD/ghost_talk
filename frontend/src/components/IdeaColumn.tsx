import IdeaCard from "./IdeaCard";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { IdeaColumnData } from "../types/session";

type IdeaColumnProps = {
  column: IdeaColumnData;
};

export default function IdeaColumn({ column }: IdeaColumnProps) {
  return (
    <Card className="h-full min-h-[420px] rounded-3xl">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span>{column.title}</span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-text-secondary">
            {column.ideas.length}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {column.ideas.map((idea) => (
          <IdeaCard key={idea.id} text={idea.text} votes={idea.votes} comments={idea.comments} />
        ))}
      </CardContent>
    </Card>
  );
}
