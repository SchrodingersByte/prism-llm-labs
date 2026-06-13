/** @type {import("@tinybirdco/sdk").TinybirdConfig} */
const tinybirdConfig = {
  include: ["lib/tinybird.ts"],
  // Falls back to legacy env var names so existing .env.local keeps working
  token:   process.env.TINYBIRD_TOKEN   ?? process.env.TINYBIRD_ADMIN_TOKEN,
  baseUrl: process.env.TINYBIRD_URL     ?? process.env.TINYBIRD_API_URL,
  devMode: "branch",
};

export default tinybirdConfig;
