import { ApiClientError } from "@/lib/api/client";

/** Friendly, non-technical messages for auth failures. */
export function describeAuthError(err: unknown, mode: "login" | "signup"): string {
  if (err instanceof ApiClientError) {
    switch (err.status) {
      case 400:
        return err.message || "Please check the details you entered.";
      case 401:
        return mode === "login" ? "That email or password doesn't match. Please try again." : "We couldn't create your account. Please try again.";
      case 403:
        return "Sign-in isn't allowed from here right now.";
      case 404:
        return mode === "login" ? "Sign-in isn't available yet on this server." : "Account creation isn't available yet on this server.";
      case 409:
        return "An account with that email already exists. Try signing in instead.";
      case 429:
        return "Too many attempts. Please wait a minute and try again.";
      default:
        if (err.status >= 500) return "Something went wrong on our side. Please try again in a moment.";
        return err.message || "Something went wrong. Please try again.";
    }
  }
  if (err instanceof TypeError) return "We couldn't reach the server. Check your connection and try again.";
  return "Something went wrong. Please try again.";
}
