import { bot, ALLOWED_UPDATES } from "./bot.js";

await bot.start({
  allowed_updates: [...ALLOWED_UPDATES],
  onStart: (info) =>
    console.log(
      `[bot] @${info.username} started — waiting for Telegram Business connections`,
    ),
});
