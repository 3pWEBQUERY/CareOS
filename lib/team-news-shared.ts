// Team news definitions shared by the API and the client workspace.

export const POST_IMPORTANCE = {
  normal: { label: "Info", tone: "info" },
  important: { label: "Wichtig", tone: "attention" },
  critical: { label: "Dringend", tone: "critical" },
} as const;
export type PostImportance = keyof typeof POST_IMPORTANCE;

export const CHANNEL_COLORS = ["blue", "green", "orange", "purple", "red", "gray"] as const;
export type ChannelColor = (typeof CHANNEL_COLORS)[number];

export type Channel = {
  id: string;
  name: string;
  description: string | null;
  color: ChannelColor;
  isDefault: boolean;
  managersOnly: boolean;
  careUnit: string | null;
  members: number;
  joined: boolean;
  unread: number;
  canPost: boolean;
};

export type Post = {
  id: string;
  channelId: string;
  channelName: string;
  channelColor: ChannelColor;
  authorName: string | null;
  title: string;
  body: string;
  importance: PostImportance;
  pinned: boolean;
  requiresAck: boolean;
  createdAt: string;
  editedAt: string | null;
  readAt: string | null;
  acknowledgedAt: string | null;
  readCount: number;
  ackCount: number;
  audience: number;
  canEdit: boolean;
  isOwn: boolean;
};

export type OnDutyPerson = { userId: string; name: string; detail: string; state: "present" | "planned" };

export type TeamNewsPayload = {
  channels: Channel[];
  posts: Post[];
  onDuty: OnDutyPerson[];
  careUnits: Array<{ id: string; name: string }>;
  stats: { postsThisWeek: number; joinedChannels: number; unread: number; reach: number | null };
  canManage: boolean;
  currentUserId: string;
};
