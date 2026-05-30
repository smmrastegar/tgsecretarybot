import { getBot, ALLOWED_UPDATES } from "../lib/bot";

const bot = getBot();

await bot.start({
  allowed_updates: [...ALLOWED_UPDATES],
  onStart: (info) =>
    console.log(
      `[bot] @${info.username} started — waiting for Telegram Business connections`,
    ),
});
