export const METHODOLOGIES = [
  { value: "brainwriting" },
  { value: "swot" },
  { value: "start_stop_continue" },
  { value: "anonymous_qa" },
];

export function participantKey(code) {
  return `ghosttalk_participant_${String(code).toUpperCase()}`;
}

export function facilitatorKey(code) {
  return `ghosttalk_facilitator_${String(code).toUpperCase()}`;
}
