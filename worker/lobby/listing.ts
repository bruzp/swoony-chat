import { matchesFilter, type PublicUser, type UserFilter } from "@shared/profile";
import { LIST_CURSOR_PATTERN } from "@shared/protocol/lobby";
import { toPublicUser, type ListPosition, type UserRow } from "./userTable";

export interface ListViewer {
  userId: string;
  country: string;
  hidden: Set<string>;
}

type Group = 0 | 1;
type Position = ListPosition;

export function parseCursor(cursor: string | null): Position | null {
  if (cursor === null || !LIST_CURSOR_PATTERN.test(cursor)) return null;
  const [group, joinedAt, userId] = cursor.split(":");
  const isOldTwoPartCursor = userId === undefined || joinedAt === undefined;
  if (isOldTwoPartCursor) return null;
  return { group: group === "0" ? 0 : 1, joinedAt: Number(joinedAt), userId };
}

function toCursor(position: Position): string {
  return `${String(position.group)}:${String(position.joinedAt)}:${position.userId}`;
}

function positionOf(row: UserRow, viewer: ListViewer): Position {
  const group: Group = row.country === viewer.country ? 0 : 1;
  return { group, joinedAt: row.joinedAt, userId: row.userId };
}

function listOrder(a: Position, b: Position): number {
  if (a.group !== b.group) return a.group - b.group;
  if (a.joinedAt !== b.joinedAt) return b.joinedAt - a.joinedAt;
  if (a.userId === b.userId) return 0;
  return a.userId < b.userId ? 1 : -1;
}

export function listUsers(
  rows: UserRow[],
  viewer: ListViewer,
  filter: UserFilter,
  cursor: string | null,
  pageSize: number,
): { users: PublicUser[]; nextCursor: string | null } {
  const after = parseCursor(cursor);
  const visible = rows
    .filter(
      (row) =>
        row.userId !== viewer.userId &&
        !viewer.hidden.has(row.userId) &&
        row.disconnectedAt === null &&
        matchesFilter(row, filter),
    )
    .map((row) => ({ row, position: positionOf(row, viewer) }))
    .filter(({ position }) => after === null || listOrder(after, position) < 0)
    .sort((a, b) => listOrder(a.position, b.position));
  const page = visible.slice(0, pageSize);
  const last = page.at(-1);
  return {
    users: page.map(({ row }) => toPublicUser(row)),
    nextCursor: visible.length > pageSize && last ? toCursor(last.position) : null,
  };
}
