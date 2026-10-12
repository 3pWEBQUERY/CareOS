// Kleiner OpenID-Connect-Anbieter nur für Tests (DB- und Klicktests): Discovery, JWKS, Authorization Code mit
// PKCE (S256) und RS256-signiertes ID-Token. Angemeldet wird die Person, die zuletzt über /__user gesetzt wurde.
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { createServer } from "node:http";

export const MOCK_CLIENT_ID = "carecore-test";
export const MOCK_CLIENT_SECRET = "carecore-test-secret";

const b64url = (value) => Buffer.from(value).toString("base64url");

export function startMockOidc(port = 0) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test", alg: "RS256", use: "sig" };
  const codes = new Map();
  const state = { user: { preferred_username: "nobody", email: "nobody@example.org", sub: "nobody" } };
  let issuer = "";

  const idToken = (claims) => {
    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test" }));
    const now = Math.floor(Date.now() / 1000);
    const payload = b64url(JSON.stringify({ iss: issuer, aud: MOCK_CLIENT_ID, iat: now, exp: now + 300, ...claims }));
    return `${header}.${payload}.${b64url(sign("sha256", Buffer.from(`${header}.${payload}`), privateKey))}`;
  };
  const json = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url, issuer);
    if (url.pathname === "/.well-known/openid-configuration")
      return json(res, 200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
      });
    if (url.pathname === "/jwks") return json(res, 200, { keys: [jwk] });
    if (url.pathname === "/__user") {
      state.user = {
        preferred_username: url.searchParams.get("username") ?? "nobody",
        email: url.searchParams.get("email") ?? `${url.searchParams.get("username")}@example.org`,
        sub: url.searchParams.get("sub") ?? `sub-${url.searchParams.get("username")}`,
      };
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/authorize") {
      const redirect = new URL(url.searchParams.get("redirect_uri"));
      if (
        url.searchParams.get("client_id") !== MOCK_CLIENT_ID ||
        url.searchParams.get("code_challenge_method") !== "S256"
      )
        return json(res, 400, { error: "invalid_request" });
      const code = b64url(randomBytes(16));
      codes.set(code, {
        challenge: url.searchParams.get("code_challenge"),
        nonce: url.searchParams.get("nonce"),
        redirectUri: redirect.toString(),
        user: state.user,
      });
      redirect.searchParams.set("code", code);
      redirect.searchParams.set("state", url.searchParams.get("state") ?? "");
      redirect.searchParams.set("iss", issuer);
      res.writeHead(302, { location: redirect.toString() });
      return res.end();
    }
    if (url.pathname === "/token" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const form = new URLSearchParams(body);
        const basic = req.headers.authorization?.startsWith("Basic ")
          ? Buffer.from(req.headers.authorization.slice(6), "base64").toString().split(":").map(decodeURIComponent)
          : null;
        const clientId = basic?.[0] ?? form.get("client_id");
        const secret = basic?.[1] ?? form.get("client_secret");
        if (clientId !== MOCK_CLIENT_ID || secret !== MOCK_CLIENT_SECRET)
          return json(res, 401, { error: "invalid_client" });
        const entry = codes.get(form.get("code"));
        codes.delete(form.get("code"));
        const challenge = createHash("sha256")
          .update(form.get("code_verifier") ?? "")
          .digest("base64url");
        if (!entry || entry.challenge !== challenge || entry.redirectUri !== form.get("redirect_uri"))
          return json(res, 400, { error: "invalid_grant" });
        return json(res, 200, {
          access_token: b64url(randomBytes(16)),
          token_type: "Bearer",
          expires_in: 300,
          id_token: idToken({ ...entry.user, nonce: entry.nonce }),
        });
      });
      return;
    }
    json(res, 404, { error: "not_found" });
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      issuer = `http://localhost:${server.address().port}`;
      resolve({
        issuer,
        setUser: (user) => {
          state.user = {
            email: `${user.preferred_username}@example.org`,
            sub: `sub-${user.preferred_username}`,
            ...user,
          };
        },
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

// Als eigener Prozess für die Klicktests: node tests/support/mock-oidc.mjs <port>
if (process.argv[1]?.endsWith("mock-oidc.mjs")) {
  const port = Number(process.argv[2] ?? 3299);
  startMockOidc(port).then(({ issuer }) => console.log(`Test-OIDC auf ${issuer}`));
}
