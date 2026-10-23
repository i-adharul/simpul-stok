import { parseEnv } from "./env-schema";

// Validated once, when this module is first imported. Importing it fails fast on bad config.
export const env = parseEnv(process.env);
