export type SessionStatus = "active" | "draft" | "completed";

export type SessionSummary = {
  title: string;
  method: string;
  participants: number;
  status: SessionStatus;
  updatedAt: string;
};

export type IdeaCardItem = {
  id: string;
  text: string;
  votes: number;
  comments: number;
};

export type IdeaColumnData = {
  id: string;
  title: string;
  ideas: IdeaCardItem[];
};

export type SessionData = {
  title: string;
  methodName: string;
  participantsCount: number;
  isAnonymous: boolean;
  currentStage: string;
  stageIndex: number;
  stageProgress: number;
  sessionCode: string;
  facilitatorName: string;
  timer: string;
  columns: IdeaColumnData[];
  participantInitials: string[];
};
