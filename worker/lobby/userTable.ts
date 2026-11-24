import { nicknameKey, type Gender, type PublicUser, type UserFilter } from "@shared/profile";

export interface ListPosition {
  group: 0 | 1;
  joinedAt: number;
  userId: string;
}

export type UserRow = PublicUser & {
  deviceId: string;
  ip: string;
  joinedAt: number;
  lastActiveAt: number;
  disconnectedAt: number | null;
};

export interface ChatRow {
  chatId: string;
  userA: string;
  userB: string;
}

export interface ContactRow {
  owner: string;
  other: string;
  otherDeviceHash: string;
  otherNetworkHash: string;
}

export interface Contact {
  otherDeviceHash: string;
  otherNetworkHash: string;
  otherSpoke: boolean;
}

type ContactRecord = {
  other_device_hash: string;
  other_network_hash: string;
  other_spoke: number;
};

type ChatRecord = {
  chat_id: string;
  user_a: string;
  user_b: string;
};

function toChatRow(record: ChatRecord): ChatRow {
  return { chatId: record.chat_id, userA: record.user_a, userB: record.user_b };
}

export function peerOf(chat: ChatRow, userId: string): string {
  return chat.userA === userId ? chat.userB : chat.userA;
}

type UserRecord = {
  device_id: string;
  user_id: string;
  nickname_key: string;
  nickname: string;
  gender: string;
  age: number;
  country: string;
  bio: string;
  ip: string;
  joined_at: number;
  last_active_at: number;
  disconnected_at: number | null;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  device_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  nickname_key TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL,
  gender TEXT NOT NULL,
  age INTEGER NOT NULL,
  country TEXT NOT NULL,
  bio TEXT NOT NULL,
  ip TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  disconnected_at INTEGER
);
CREATE TABLE IF NOT EXISTS blocks (
  blocker TEXT NOT NULL,
  blocked TEXT NOT NULL,
  PRIMARY KEY (blocker, blocked)
);
CREATE INDEX IF NOT EXISTS blocks_blocked ON blocks (blocked);
CREATE TABLE IF NOT EXISTS chats (
  chat_id TEXT PRIMARY KEY,
  user_a TEXT NOT NULL,
  user_b TEXT NOT NULL,
  a_spoke INTEGER NOT NULL DEFAULT 0,
  b_spoke INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chats_user_a ON chats (user_a);
CREATE INDEX IF NOT EXISTS chats_user_b ON chats (user_b);
CREATE TABLE IF NOT EXISTS contacts (
  owner TEXT NOT NULL,
  other TEXT NOT NULL,
  other_device_hash TEXT NOT NULL,
  other_network_hash TEXT NOT NULL,
  other_spoke INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner, other)
);`;

const COLUMNS = {
  userId: "user_id",
  nickname: "nickname",
  gender: "gender",
  age: "age",
  country: "country",
  bio: "bio",
  ip: "ip",
  joinedAt: "joined_at",
  lastActiveAt: "last_active_at",
  disconnectedAt: "disconnected_at",
} as const satisfies Partial<Record<keyof UserRow, string>>;

type UpdatableField = keyof typeof COLUMNS;

function isUpdatableField(field: string): field is UpdatableField {
  return Object.hasOwn(COLUMNS, field);
}

function toRow(record: UserRecord): UserRow {
  return {
    deviceId: record.device_id,
    userId: record.user_id,
    nickname: record.nickname,
    gender: record.gender as Gender,
    age: record.age,
    country: record.country,
    bio: record.bio,
    ip: record.ip,
    joinedAt: record.joined_at,
    lastActiveAt: record.last_active_at,
    disconnectedAt: record.disconnected_at,
  };
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    userId: row.userId,
    nickname: row.nickname,
    gender: row.gender,
    age: row.age,
    country: row.country,
    bio: row.bio,
  };
}

export class UserTable {
  constructor(private readonly sql: SqlStorage) {}

  ensureSchema(): void {
    this.sql.exec(SCHEMA);
  }

  insert(row: UserRow): void {
    this.sql.exec(
      `INSERT INTO users (device_id, user_id, nickname_key, nickname, gender, age, country, bio, ip, joined_at, last_active_at, disconnected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.deviceId,
      row.userId,
      nicknameKey(row.nickname),
      row.nickname,
      row.gender,
      row.age,
      row.country,
      row.bio,
      row.ip,
      row.joinedAt,
      row.lastActiveAt,
      row.disconnectedAt,
    );
  }

  byDevice(deviceId: string): UserRow | null {
    return this.first("SELECT * FROM users WHERE device_id = ?", deviceId);
  }

  byUserId(userId: string): UserRow | null {
    return this.first("SELECT * FROM users WHERE user_id = ?", userId);
  }

  nicknameTaken(key: string): boolean {
    return (
      this.sql.exec("SELECT 1 FROM users WHERE nickname_key = ? LIMIT 1", key).toArray().length > 0
    );
  }

  count(): number {
    return this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM users").one().n;
  }

  onlineCount(): number {
    return this.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE disconnected_at IS NULL")
      .one().n;
  }

  othersOnlineVisibleTo(userId: string): number {
    return this.sql
      .exec<{ n: number }>(
        `SELECT COUNT(*) AS n FROM users
         WHERE disconnected_at IS NULL AND user_id <> ?1
           AND user_id NOT IN (SELECT blocked FROM blocks WHERE blocker = ?1
             UNION SELECT blocker FROM blocks WHERE blocked = ?1)`,
        userId,
      )
      .one().n;
  }

  hiddenFor(userId: string): Set<string> {
    const rows = this.sql
      .exec<{ other: string }>(
        `SELECT blocked AS other FROM blocks WHERE blocker = ?
         UNION SELECT blocker AS other FROM blocks WHERE blocked = ?`,
        userId,
        userId,
      )
      .toArray();
    return new Set(rows.map((row) => row.other));
  }

  hiddenByUser(): Map<string, Set<string>> {
    const hidden = new Map<string, Set<string>>();
    const hide = (viewer: string, other: string) => {
      const set = hidden.get(viewer) ?? new Set<string>();
      set.add(other);
      hidden.set(viewer, set);
    };
    for (const { blocker, blocked } of this.sql
      .exec<{ blocker: string; blocked: string }>("SELECT blocker, blocked FROM blocks")
      .toArray()) {
      hide(blocker, blocked);
      hide(blocked, blocker);
    }
    return hidden;
  }

  insertBlock(blocker: string, blocked: string): void {
    this.sql.exec(
      `INSERT INTO blocks (blocker, blocked)
       SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM users WHERE user_id = ?1)
       ON CONFLICT DO NOTHING`,
      blocker,
      blocked,
    );
  }

  contact(owner: string, other: string): Contact | null {
    const [record] = this.sql
      .exec<ContactRecord>(
        `SELECT other_device_hash, other_network_hash, other_spoke FROM contacts
         WHERE owner = ? AND other = ?`,
        owner,
        other,
      )
      .toArray();
    if (!record) return null;
    return {
      otherDeviceHash: record.other_device_hash,
      otherNetworkHash: record.other_network_hash,
      otherSpoke: record.other_spoke === 1,
    };
  }

  listPage(
    viewer: { userId: string; country: string },
    filter: UserFilter,
    after: ListPosition | null,
    limit: number,
  ): UserRow[] {
    const where = [
      "disconnected_at IS NULL",
      "user_id <> :me",
      `user_id NOT IN (SELECT blocked FROM blocks WHERE blocker = :me
        UNION SELECT blocker FROM blocks WHERE blocked = :me)`,
    ];
    const params: SqlStorageValue[] = [viewer.userId, viewer.country];
    const bind = (value: SqlStorageValue) => {
      params.push(value);
      return `?${String(params.length)}`;
    };
    if (filter.genders?.length) {
      where.push(
        `gender IN (SELECT value FROM json_each(${bind(JSON.stringify(filter.genders))}))`,
      );
    }
    if (filter.minAge !== undefined) where.push(`age >= ${bind(filter.minAge)}`);
    if (filter.maxAge !== undefined) where.push(`age <= ${bind(filter.maxAge)}`);
    if (filter.countries?.length) {
      where.push(
        `country IN (SELECT value FROM json_each(${bind(JSON.stringify(filter.countries))}))`,
      );
    }
    if (after) {
      const group = bind(after.group);
      const joinedAt = bind(after.joinedAt);
      where.push(
        `(grp > ${group} OR (grp = ${group} AND (joined_at < ${joinedAt}
          OR (joined_at = ${joinedAt} AND user_id < ${bind(after.userId)}))))`,
      );
    }
    const sql = `SELECT * FROM (
        SELECT *, CASE WHEN country = ?2 THEN 0 ELSE 1 END AS grp FROM users
      ) WHERE ${where.join(" AND ").replaceAll(":me", "?1")}
      ORDER BY grp, joined_at DESC, user_id DESC LIMIT ${bind(limit)}`;
    return this.sql
      .exec<UserRecord>(sql, ...params)
      .toArray()
      .map(toRow);
  }

  all(): UserRow[] {
    return this.sql.exec<UserRecord>("SELECT * FROM users").toArray().map(toRow);
  }

  update(deviceId: string, patch: Partial<UserRow>): void {
    const assignments: string[] = [];
    const values: SqlStorageValue[] = [];
    for (const [field, value] of Object.entries(patch)) {
      if (!isUpdatableField(field)) continue;
      assignments.push(`${COLUMNS[field]} = ?`);
      values.push(value);
      if (field === "nickname" && typeof value === "string") {
        assignments.push("nickname_key = ?");
        values.push(nicknameKey(value));
      }
    }
    if (assignments.length === 0) return;
    this.sql.exec(
      `UPDATE users SET ${assignments.join(", ")} WHERE device_id = ?`,
      ...values,
      deviceId,
    );
  }

  delete(deviceId: string): void {
    this.sql.exec("DELETE FROM users WHERE device_id = ?", deviceId);
  }

  wipe(row: UserRow): void {
    this.sql.exec("DELETE FROM blocks WHERE blocker = ? OR blocked = ?", row.userId, row.userId);
    this.sql.exec("DELETE FROM chats WHERE user_a = ? OR user_b = ?", row.userId, row.userId);
    this.sql.exec("DELETE FROM contacts WHERE owner = ?", row.userId);
    this.delete(row.deviceId);
  }

  touch(userId: string, now: number): void {
    this.sql.exec(
      "UPDATE users SET last_active_at = MAX(last_active_at, ?) WHERE user_id = ?",
      now,
      userId,
    );
  }

  markDisconnected(userIds: readonly string[], now: number): void {
    this.sql.exec(
      `UPDATE users SET disconnected_at = ?
       WHERE disconnected_at IS NULL AND user_id IN (SELECT value FROM json_each(?))`,
      now,
      JSON.stringify(userIds),
    );
  }

  connectedUserIds(): string[] {
    return this.sql
      .exec<{ user_id: string }>("SELECT user_id FROM users WHERE disconnected_at IS NULL")
      .toArray()
      .map((record) => record.user_id);
  }

  disconnectedSince(cutoff: number): UserRow[] {
    return this.sql
      .exec<UserRecord>("SELECT * FROM users WHERE disconnected_at <= ?", cutoff)
      .toArray()
      .map(toRow);
  }

  idleSince(cutoff: number): UserRow[] {
    return this.sql
      .exec<UserRecord>("SELECT * FROM users WHERE last_active_at <= ?", cutoff)
      .toArray()
      .map(toRow);
  }

  chatById(chatId: string): ChatRow | null {
    const [record] = this.sql
      .exec<ChatRecord>("SELECT chat_id, user_a, user_b FROM chats WHERE chat_id = ?", chatId)
      .toArray();
    return record ? toChatRow(record) : null;
  }

  chatsOf(userId: string): ChatRow[] {
    return this.sql
      .exec<ChatRecord>(
        "SELECT chat_id, user_a, user_b FROM chats WHERE user_a = ? OR user_b = ? ORDER BY created_at",
        userId,
        userId,
      )
      .toArray()
      .map(toChatRow);
  }

  insertChat(chat: ChatRow, createdAt: number, contacts: readonly ContactRow[]): void {
    this.sql.exec(
      "INSERT INTO chats (chat_id, user_a, user_b, created_at) VALUES (?, ?, ?, ?)",
      chat.chatId,
      chat.userA,
      chat.userB,
      createdAt,
    );
    for (const contact of contacts) {
      this.sql.exec(
        `INSERT INTO contacts (owner, other, other_device_hash, other_network_hash) VALUES (?, ?, ?, ?)
         ON CONFLICT (owner, other) DO UPDATE SET
           other_device_hash = excluded.other_device_hash,
           other_network_hash = excluded.other_network_hash`,
        contact.owner,
        contact.other,
        contact.otherDeviceHash,
        contact.otherNetworkHash,
      );
    }
  }

  deleteChat(chatId: string): void {
    this.sql.exec("DELETE FROM chats WHERE chat_id = ?", chatId);
  }

  markSpoke(chatId: string, userId: string): void {
    const chat = this.chatById(chatId);
    if (!chat || (chat.userA !== userId && chat.userB !== userId)) return;
    const column = chat.userA === userId ? "a_spoke" : "b_spoke";
    this.sql.exec(`UPDATE chats SET ${column} = 1 WHERE chat_id = ?`, chatId);
    this.sql.exec(
      "UPDATE contacts SET other_spoke = 1 WHERE owner = ? AND other = ?",
      peerOf(chat, userId),
      userId,
    );
  }

  private first(query: string, ...bindings: SqlStorageValue[]): UserRow | null {
    const [record] = this.sql.exec<UserRecord>(query, ...bindings).toArray();
    return record ? toRow(record) : null;
  }
}
