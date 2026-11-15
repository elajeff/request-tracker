import type { RequestPriority, RequestStatus, SupportStaff } from "./types";

export const requestStatuses: RequestStatus[] = [
  "NEW",
  "IN_PROGRESS",
  "RESOLVED",
];
export const requestPriorities: RequestPriority[] = ["HIGH", "MEDIUM", "LOW"];

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unexpected error.";

export const uniqueById = <T extends { id: string | number }>(items: T[]) => [
  ...new Map(items.map((item) => [item.id, item])).values(),
];

// The order the server lists staff in: lowercased name by character code, then ID.
export const compareStaff = (a: SupportStaff, b: SupportStaff) => {
  const first = a.name.toLowerCase();
  const second = b.name.toLowerCase();
  return first === second ? (a.id < b.id ? -1 : 1) : first < second ? -1 : 1;
};

// IN_PROGRESS -> "In progress", HIGH -> "High".
export const label = (value: string) =>
  value[0] + value.slice(1).toLowerCase().replace("_", " ");

// Names are not unique, so people who share one also get the start of their ID.
export const staffLabel = (person: SupportStaff, everyone: SupportStaff[]) => {
  const name = person.name || "(no name)";
  const shared = everyone.some(
    (other) => other.id !== person.id && other.name === person.name,
  );
  return `${name}${shared ? ` (${person.id.slice(0, 8)})` : ""}${person.active ? "" : " (inactive)"}`;
};
