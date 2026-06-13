/**
 * BoxyHQ SAML Jackson — external service proxy.
 *
 * Prism uses Jackson as a dedicated SSO service (self-hosted or SaaS).
 * Set these env vars:
 *   JACKSON_URL      = https://your-jackson-instance.com  (or https://api.jackson.boxyhq.com)
 *   JACKSON_API_KEY  = your-jackson-api-key
 *
 * Jackson docs: https://boxyhq.com/docs/jackson/overview
 */

const JACKSON_URL     = process.env.JACKSON_URL ?? "";
const JACKSON_API_KEY = process.env.JACKSON_API_KEY ?? "";

function jacksonHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization:  `Api-Key ${JACKSON_API_KEY}`,
  };
}

export interface SSOConnection {
  clientID:        string;
  clientSecret:    string;
  name?:           string;
  description?:    string;
  redirectUrl:     string[];
  defaultRedirectUrl: string;
  tenant:          string;
  product:         string;
  idpMetadata?:    { entityID: string; sso: { redirectUrl: string } };
}

export interface SSOProfile {
  id:       string;
  email:    string;
  firstName?: string;
  lastName?:  string;
  roles?:   string[];
  groups?:  string[];
  raw:      Record<string, unknown>;
}

/** Create or update a SAML SSO connection in Jackson */
export async function upsertSAMLConnection(params: {
  rawMetadata:  string;  // IdP metadata XML (raw, not base64)
  redirectUrl:  string;
  tenant:       string;  // account_id
  product:      string;  // "prism"
  name?:        string;
}) {
  if (!JACKSON_URL) throw new Error("JACKSON_URL not configured");

  const res = await fetch(`${JACKSON_URL}/api/v1/saml/config`, {
    method:  "POST",
    headers: jacksonHeaders(),
    body:    JSON.stringify({
      encodedRawMetadata: Buffer.from(params.rawMetadata).toString("base64"),
      defaultRedirectUrl: params.redirectUrl,
      redirectUrl:        JSON.stringify([params.redirectUrl]),
      tenant:             params.tenant,
      product:            params.product,
      name:               params.name ?? "Prism SSO",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jackson config error ${res.status}: ${text}`);
  }

  return res.json() as Promise<{ clientID: string; clientSecret: string }>;
}

/** Create or update an OIDC SSO connection in Jackson */
export async function upsertOIDCConnection(params: {
  clientId:     string;
  clientSecret: string;
  issuer:       string;
  redirectUrl:  string;
  tenant:       string;
  product:      string;
  name?:        string;
}) {
  if (!JACKSON_URL) throw new Error("JACKSON_URL not configured");

  const res = await fetch(`${JACKSON_URL}/api/v1/oidc/config`, {
    method:  "POST",
    headers: jacksonHeaders(),
    body:    JSON.stringify({
      oidcDiscoveryUrl: `${params.issuer}/.well-known/openid-configuration`,
      oidcClientId:     params.clientId,
      oidcClientSecret: params.clientSecret,
      defaultRedirectUrl: params.redirectUrl,
      redirectUrl:        JSON.stringify([params.redirectUrl]),
      tenant:             params.tenant,
      product:            params.product,
      name:               params.name ?? "Prism OIDC",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jackson OIDC config error ${res.status}: ${text}`);
  }

  return res.json() as Promise<{ clientID: string; clientSecret: string }>;
}

/** Delete a SSO connection from Jackson */
export async function deleteSSOConnection(clientID: string, clientSecret: string) {
  if (!JACKSON_URL) return;

  await fetch(`${JACKSON_URL}/api/v1/saml/config`, {
    method:  "DELETE",
    headers: jacksonHeaders(),
    body:    JSON.stringify({ clientID, clientSecret }),
  });
}

/** Get the Jackson authorization URL for a given tenant */
export function getAuthorizeUrl(params: {
  tenant:      string;
  product:     string;
  redirectUri: string;
  state:       string;
}) {
  if (!JACKSON_URL) throw new Error("JACKSON_URL not configured");

  const qs = new URLSearchParams({
    response_type: "code",
    client_id:     `tenant=${params.tenant}&product=${params.product}`,
    redirect_uri:  params.redirectUri,
    state:         params.state,
    scope:         "openid email profile",
  });

  return `${JACKSON_URL}/api/oauth/authorize?${qs}`;
}

/** Exchange authorization code for a user profile */
export async function exchangeCodeForProfile(params: {
  code:        string;
  redirectUri: string;
  tenant:      string;
  product:     string;
}): Promise<SSOProfile> {
  if (!JACKSON_URL) throw new Error("JACKSON_URL not configured");

  // Step 1: exchange code for token
  const tokenRes = await fetch(`${JACKSON_URL}/api/oauth/token`, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams({
      grant_type:    "authorization_code",
      code:          params.code,
      redirect_uri:  params.redirectUri,
      client_id:     `tenant=${params.tenant}&product=${params.product}`,
      client_secret: "dummy",  // Jackson doesn't require a real secret here
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Jackson token error ${tokenRes.status}: ${text}`);
  }

  const { access_token } = await tokenRes.json() as { access_token: string };

  // Step 2: get user profile
  const profileRes = await fetch(`${JACKSON_URL}/api/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!profileRes.ok) {
    const text = await profileRes.text();
    throw new Error(`Jackson userinfo error ${profileRes.status}: ${text}`);
  }

  return profileRes.json() as Promise<SSOProfile>;
}

export function isConfigured() {
  return Boolean(JACKSON_URL && JACKSON_API_KEY);
}
