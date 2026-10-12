// Data shapes and labels of the per-chat page (/chats/[id]). Moved out of the page file unchanged.
export type ChatMode = "off" | "secretary" | "auto_reply" | "friendly_reply" | "ai_chat" | "ai_listen";

export const MODE_LABELS: Record<ChatMode, string> = {
  off: "خاموش",
  secretary: "منشی",
  auto_reply: "پاسخ خودکار",
  friendly_reply: "پاسخ خودکار صمیمی (AI)",
  ai_chat: "چت AI (کامل)",
  ai_listen: "شنود AI (بی‌صدا، خلاصه می‌کنه)",
};

export type Relationship =
  | "close_family"
  | "family"
  | "close_friend"
  | "friend"
  | "work_acquaintance"
  | "employer"
  | "formal"
  | "suspicious"
  | "stranger";

export const RELATIONSHIP_LABELS: Record<Relationship, string> = {
  close_family: "فامیل نزدیک",
  family: "فامیل",
  close_friend: "دوست خیلی صمیمی",
  friend: "دوست معمولی",
  work_acquaintance: "آشنای کاری",
  employer: "کارفرما",
  formal: "رودروایسی",
  suspicious: "آدم مشکوک",
  stranger: "آدم ناشناس",
};

export type Tone = "neutral" | "success" | "warn" | "danger" | "info";

export const RELATIONSHIP_TONES: Record<Relationship, Tone> = {
  close_family: "success",
  family: "info",
  close_friend: "success",
  friend: "info",
  work_acquaintance: "neutral",
  employer: "warn",
  formal: "neutral",
  suspicious: "danger",
  stranger: "neutral",
};

export type Message = {
  id: number;
  createdAt: string;
  senderName: string;
  senderUsername: string | null;
  senderId: number | null;
  messageText: string;
  importance: number;
  urgent: boolean;
  alerted: boolean;
  autoReplied: boolean;
  mediaKind: string | null;
  transcript: string | null;
  mediaDescription: string | null;
  otpCode: string | null;
  deletedAt: string | null;
  editedAt: string | null;
  editCount: number;
  fromOwner: boolean;
  isPrivateConversation: boolean;
  privateRevealedAt: string | null;
};

export type Rule = {
  chatId: number;
  chatType: string;
  chatTitle: string | null;
  vip: boolean;
  muted: boolean;
  customReply: string | null;
  notes: string | null;
  mode: ChatMode;
  modeChangedAt: string;
  secretaryUserId: number | null;
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  relationship: Relationship | null;
  relationshipNotes: string | null;
  talkStyleNotes: string | null;
  toneProfile: string | null;
  toneProfileAt: string | null;
  floodCooldownUntil: string | null;
  floodDeflectedAt: string | null;
  aiProcessVoice: boolean;
  aiProcessStickers: boolean;
  aiProcessGifs: boolean;
  aiProcessPhotos: boolean;
  aiProcessVideoNotes: boolean;
  aiGeneratePhoto: boolean;
  functionRole:
    | "downloader"
    | "sms_inbox"
    | "download_archive"
    | "news"
    | "summary_inbox"
    | "storage"
    | "voice_storage"
    | "video_storage"
    | "photo_storage"
    | "notes_inbox"
    | "email_inbox"
    | null;
  functionConfig: Record<string, unknown> | null;
  autoSummarizeEnabled: boolean;
  autoSummarizeGapMinutes: number;
  autoSummarizeSmartTiming: boolean;
  lastAutoSummaryAt: string | null;
  autoForwardVoice: boolean;
  autoForwardVideo: boolean;
  autoForwardPhoto: boolean;
  autoForwardLocation: boolean;
  autoExtractNotes: boolean;
  selfVoiceTranscript: boolean;
  isBot: boolean;
  ignored: boolean;
  phoneNumber: string | null;
  graceSkippedAt: string | null;
  followUpEnabled: boolean;
  followUpThresholdHours: number;
  followUpEscalateHours: number;
  profileId: number | null;
  updatedAt: string;
};

export type ProfileSummary = {
  id: number;
  name: string;
  emoji: string | null;
  isDefault: boolean;
};

export const FUNCTION_ROLE_LABELS: Record<string, string> = {
  downloader: "📥 Downloader bot",
  sms_inbox: "📱 SMS inbox",
  download_archive: "🗄 Download archive",
  news: "📰 News source",
  summary_inbox: "📬 Summary inbox",
  storage: "📦 Storage (Instagram media)",
  voice_storage: "🎤 Voice storage",
  video_note_storage: "🎥 Video-note storage (round bubbles)",
  video_storage: "🎬 Video storage",
  photo_storage: "🖼 Photo storage",
  notes_inbox: "📒 Notes inbox",
  email_inbox: "📧 Email inbox (Resend)",
};
export const ALL_FUNCTION_ROLES = Object.keys(FUNCTION_ROLE_LABELS);

export type GraceInfo = {
  minutes: number;
  lastOwnerSentAt: string | null;
};

export type Stats = {
  priorCount: number;
  urgentCount: number;
  lastSeen: string | null;
  firstSeen: string | null;
};

export type ThreadMsg = {
  id: number;
  createdAt: string;
  senderName: string;
  messageText: string;
  transcript: string | null;
  mediaDescription: string | null;
  otpCode: string | null;
  mediaKind: string | null;
  mediaFileId: string | null;
  importance: number;
  urgent: boolean;
  fromOwner: boolean;
};

export type ThreadGroup = {
  threadNo: number;
  startedAt: string;
  endedAt: string;
  messageCount: number;
  senders: string[];
  messages: ThreadMsg[];
  summary: {
    summary: string;
    topics: string[];
    actionItems: string[];
    createdAt: string;
    stale: boolean;
  } | null;
};

export type MessageEdit = {
  id: number;
  previousText: string | null;
  previousTranscript: string | null;
  editedAt: string;
};

export type Suggestion = {
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  relationship: string | null;
  relationshipNotes: string | null;
  talkStyleNotes: string | null;
  reasoning: string;
};

// Personal-info form (firstName / lastName / nickname / relationship). Kept in a local draft so the owner can
// type freely; only commits on Save.
export type Personal = {
  firstName: string;
  lastName: string;
  nickname: string;
  relationship: Relationship | "";
  relationshipNotes: string;
  talkStyleNotes: string;
  notes: string;
};

export type LogEntry = {
  id: number;
  sourceChatId: number;
  sourceMessageId: number | null;
  kind: string;
  decision: string;
  targetRole: string | null;
  targetChatId: number | null;
  targetMessageId: number | null;
  error: string | null;
  createdAt: string;
};
