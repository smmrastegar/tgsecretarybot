// lib/db is a barrel. The implementation lives in lib/db/*, split by
// domain; this file exists so the hundreds of `from "@/lib/db"` and
// `from "./db"` imports keep working unchanged.
export * from "./db/core";
export * from "./db/connections";
export * from "./db/messages";
export * from "./db/topics";
export * from "./db/chats";
export * from "./db/media";
export * from "./db/sms";
export * from "./db/groups";
export * from "./db/board";
export * from "./db/notes";
export * from "./db/secretary";
export * from "./db/usage";
export * from "./db/system";
export * from "./db/monitoring";
export * from "./db/rules";
export * from "./db/access";
