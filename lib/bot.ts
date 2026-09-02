// lib/bot is a barrel. The implementation lives in lib/bot/*, split by
// responsibility; this file keeps every `from "@/lib/bot"` / `./bot`
// import working unchanged.
export * from "./bot/core";
export * from "./bot/callbacks";
export * from "./bot/summary";
export * from "./bot/business";
export * from "./bot/rules-apply";
export * from "./bot/relay";
export * from "./bot/group";
export * from "./bot/mirror";
