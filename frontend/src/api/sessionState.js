export const METHODOLOGIES = [
  { value: "brainwriting" },
  { value: "swot" },
  { value: "start_stop_continue" },
  { value: "anonymous_qa" },
];

export function videoDisplayNameKey(code, role) {
  return `ghosttalk_video_name_${role}_${String(code).toUpperCase()}`;
}
