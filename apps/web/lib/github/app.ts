/**
 * GitHub App helpers — installation token generation.
 *
 * Required env vars:
 *   GITHUB_APP_ID          — numeric App ID from GitHub App settings
 *   GITHUB_APP_PRIVATE_KEY — PEM private key (newlines as \n or actual newlines)
 *   GITHUB_APP_SLUG        — URL slug used for installation URLs
 *   GITHUB_CLIENT_ID       — OAuth App / GitHub App Client ID
 *   GITHUB_CLIENT_SECRET   — OAuth App / GitHub App Client Secret
 */

import { createPrivateKey } from "crypto";
import { SignJWT } from "jose";

/**
 * Generate a GitHub App JWT (valid for 10 minutes).
 * Used to authenticate as the App itself (not as a user).
 */
async function generateAppJwt(): Promise<string> {
  const appId      = process.env.GITHUB_APP_ID!;
  const rawKey     = (process.env.GITHUB_APP_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");

  const privateKey = createPrivateKey({ key: rawKey, format: "pem" });

  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt(now - 60)       // allow 60s clock skew
    .setExpirationTime(now + 540) // 9 minutes (max 10)
    .setIssuer(appId)
    .sign(privateKey);
}

/**
 * Get a short-lived installation access token for the given installation.
 * Expires in 1 hour. Grants access to all repos selected in the installation.
 */
export async function getInstallationToken(
  installationId: string,
): Promise<{ token: string; expiresAt: string }> {
  const jwt = await generateAppJwt();

  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${jwt}`,
        Accept:         "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get installation token (HTTP ${res.status}): ${text}`);
  }

  const data = await res.json() as { token: string; expires_at: string };
  return { token: data.token, expiresAt: data.expires_at };
}

/**
 * Revoke an OAuth token via GitHub App credentials.
 * Used by the reconnect flow to force a fresh authorization.
 */
export async function revokeOAuthToken(accessToken: string): Promise<void> {
  const clientId     = process.env.GITHUB_CLIENT_ID!;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET!;
  const basic        = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  await fetch(`https://api.github.com/applications/${clientId}/token`, {
    method:  "DELETE",
    headers: {
      Authorization:  `Basic ${basic}`,
      Accept:         "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ access_token: accessToken }),
  });
  // Non-fatal — if revoke fails the token will expire eventually
}

/**
 * Build the GitHub App installation URL.
 * Redirects user to repo picker + OAuth authorization in one step.
 */
export function buildInstallationUrl(state: string): string {
  const appSlug = process.env.GITHUB_APP_SLUG!;
  return `https://github.com/apps/${appSlug}/installations/new?state=${encodeURIComponent(state)}`;
}
