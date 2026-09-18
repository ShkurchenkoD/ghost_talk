import {
  DashboardMetric,
  ParticipantIdea,
  ParticipantInsight,
  QuickTemplate,
  ResultHighlight,
  SessionData,
  SessionSummary,
} from "../types/session";

export const sidebarMethodologies = [
  "Anonymous feedback",
  "Brainstorming",
  "Retrospective",
  "Dot voting",
  "Risk assessment",
  "Delphi session",
];

export const dashboardMetrics: DashboardMetric[] = [
  { label: "Sessions this month", value: "24", trend: "+18% vs last month" },
  { label: "Anonymous responses", value: "486", trend: "82% completion rate" },
  { label: "Avg. time to launch", value: "4 min", trend: "From brief to shareable link" },
];

export const dashboardSessions: SessionSummary[] = [
  {
    id: "session-sprint",
    title: "Q3 roadmap alignment retrospective",
    method: "Start / Stop / Continue",
    participants: 12,
    responses: 41,
    status: "active",
    createdAt: "Jul 09, 2026",
    updatedAt: "Updated 12 min ago",
    visibility: "Anonymous guests enabled",
  },
  {
    id: "session-risk",
    title: "Launch readiness risk scan",
    method: "Risk assessment",
    participants: 9,
    responses: 27,
    status: "voting",
    createdAt: "Jul 08, 2026",
    updatedAt: "Voting closes in 2 hours",
    visibility: "Team-only access",
  },
  {
    id: "session-hr",
    title: "Manager feedback pulse check",
    method: "Anonymous feedback",
    participants: 32,
    responses: 29,
    status: "finished",
    createdAt: "Jul 02, 2026",
    updatedAt: "Results exported yesterday",
    visibility: "Anonymous mode on",
  },
];

export const quickTemplates: QuickTemplate[] = [
  {
    id: "retro-30",
    title: "Team retrospective",
    description: "Three columns, optional comments, quick voting in the final stage.",
    duration: "30 min",
  },
  {
    id: "brainstorm-20",
    title: "Rapid brainstorming",
    description: "Guest-friendly idea collection for fast cross-functional sessions.",
    duration: "20 min",
  },
  {
    id: "risk-45",
    title: "Risk assessment",
    description: "Collect risks, cluster them, then prioritize by impact and urgency.",
    duration: "45 min",
  },
  {
    id: "delphi-async",
    title: "Async Delphi",
    description: "Multiple voting rounds for sensitive or strategic decisions.",
    duration: "2 rounds",
  },
];

export const sessionMock: SessionData = {
  title: "Ideas for expanding GhostTalk into B2B onboarding",
  methodName: "Brainwriting",
  participantsCount: 24,
  responsesCount: 38,
  isAnonymous: true,
  currentStage: "Idea collection",
  stageIndex: 1,
  stageProgress: 64,
  sessionCode: "X7K9P2",
  facilitatorName: "Olena K.",
  timer: "14:32",
  participantInitials: ["AK", "IM", "NP", "TS", "YD", "VK", "OL", "RM", "EP", "DN"],
  activityFeed: [
    "2 new responses arrived in the last 90 seconds",
    "Voting stage is prepared and can be opened anytime",
    "3 cards were grouped automatically by topic",
  ],
  nextStepHint: "Keep the flow open a bit longer, then move into grouping while participation is still high.",
  columns: [
    {
      id: "product",
      title: "Product value",
      ideas: [
        { id: "1", text: "Create session templates for onboarding, retro, and leadership feedback.", votes: 18, comments: 5 },
        { id: "2", text: "Add AI clustering to merge duplicate ideas before the voting phase starts.", votes: 14, comments: 4 },
        { id: "3", text: "Let facilitators publish selected responses as highlights for discussion.", votes: 9, comments: 2 },
      ],
    },
    {
      id: "adoption",
      title: "Adoption tactics",
      ideas: [
        { id: "4", text: "Offer mobile-first guest participation so workshop links work from any phone.", votes: 13, comments: 3 },
        { id: "5", text: "Provide share-ready summaries for managers right after the session closes.", votes: 11, comments: 6 },
      ],
    },
    {
      id: "trust",
      title: "Trust signals",
      ideas: [
        { id: "6", text: "Show explicit anonymous-mode messaging before a participant submits anything.", votes: 16, comments: 7 },
        { id: "7", text: "Display moderation rules and storage policy next to the session description.", votes: 12, comments: 4 },
      ],
    },
  ],
};

export const participantInsights: ParticipantInsight[] = [
  { label: "Mode", value: "Anonymous" },
  { label: "Time needed", value: "About 3 minutes" },
  { label: "Voting", value: "Opens after ideas are collected" },
];

export const participantIdeas: ParticipantIdea[] = [
  { id: "p1", text: "Use GhostTalk for monthly HR pulse checks where managers only see grouped themes.", tag: "HR pulse", votes: 12 },
  { id: "p2", text: "Let workshop facilitators spin up a session from a QR code on a slide.", tag: "Workshops", votes: 9 },
  { id: "p3", text: "Include a confidence rating so leadership can see which ideas need validation.", tag: "Decision making", votes: 7 },
];

export const resultHighlights: ResultHighlight[] = [
  {
    title: "Anonymous participation increased input volume",
    description: "38 responses from 24 people, with 11 participants submitting more than one idea.",
    accent: "bg-soft-green text-emerald-800",
  },
  {
    title: "Trust and clarity dominated the discussion",
    description: "The highest-voted ideas focused on privacy messaging, clear moderation, and structured follow-up.",
    accent: "bg-soft-purple text-primary",
  },
  {
    title: "The session is ready for export",
    description: "Facilitator can share a short summary, CSV export, or presentation-ready markdown notes.",
    accent: "bg-soft-yellow text-amber-800",
  },
];

export const settingsSections = [
  {
    title: "Workspace profile",
    description: "Team name, default language, and invite policy for new members.",
  },
  {
    title: "Privacy defaults",
    description: "Anonymous mode, guest access, moderation queue, and participant visibility.",
  },
  {
    title: "Session templates",
    description: "Reusable structures for retrospectives, feedback cycles, and risk reviews.",
  },
];
