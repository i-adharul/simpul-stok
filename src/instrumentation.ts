// Runs once when the Next.js server starts, before it accepts requests.
// Importing the env module makes the app fail to start if configuration is invalid.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./lib/env");
  }
}
