import { webhookCallback } from "grammy";
import { bot } from "../src/bot.js";
import { config } from "../src/config.js";

export const config_vercel = { runtime: "nodejs20.x" };

export default webhookCallback(bot, "http", {
  secretToken: config.webhookSecretToken,
  timeoutMilliseconds: 25_000,
});
