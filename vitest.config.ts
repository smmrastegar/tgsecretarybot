import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    // Mirror tsconfig's "@/*" so modules under test resolve the same way
    // the app does.
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // lib/config reads env at import. These are placeholders so pure
    // modules can be imported without a live bot or database.
    env: {
      NODE_ENV: "test",
      TELEGRAM_BOT_TOKEN: "000000:test",
      OPENROUTER_API_KEY: "test-key",
      SESSION_SECRET: "test-session-secret",
    },
  },
});
