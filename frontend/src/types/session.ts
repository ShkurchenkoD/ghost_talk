export type SessionStatus = "draft" | "active" | "voting" | "finished" | "archived";

export type SessionSummary = {
  id: string;
  title: string;
  method: string;
  participants: number;
  responses: number;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  visibility: string;
};

export type QuickTemplate = {
  id: string;
  title: string;
  description: string;
  duration: string;
};

export type DashboardMetric = {
  label: string;
  value: string;
  trend: string;
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
  responsesCount: number;
  isAnonymous: boolean;
  currentStage: string;
  stageIndex: number;
  stageProgress: number;
  sessionCode: string;
  facilitatorName: string;
  timer: string;
  columns: IdeaColumnData[];
  participantInitials: string[];
  activityFeed: string[];
  nextStepHint: string;
};

export type ParticipantInsight = {
  label: string;
  value: string;
};

export type ParticipantIdea = {
  id: string;
  text: string;
  tag: string;
  votes: number;
};

export type ResultHighlight = {
  title: string;
  description: string;
  accent: string;
};
