export type StartMode = "create" | "join" | "continue";

export const START_MODES: Array<{
  id: StartMode;
  label: string;
}> = [
  { id: "create", label: "建立" },
  { id: "join", label: "加入" },
  { id: "continue", label: "繼續" },
];

export function selectInitialStartMode({ groupCount }: { groupCount: number }): StartMode {
  return groupCount > 0 ? "continue" : "create";
}
