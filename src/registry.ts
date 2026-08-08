export const iconNames = [
  "bolt",
  "book",
  "columns",
  "dollar",
  "dots",
  "file",
  "gauge",
  "key",
  "layers",
  "megaphone",
  "search",
  "shield",
  "sliders",
  "target",
  "userplus",
  "users",
] as const;

export type IconName = typeof iconNames[number];
