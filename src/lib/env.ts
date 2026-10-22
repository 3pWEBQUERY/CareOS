/** Zentrale, typisierte Konfiguration. Railway setzt Variablen pro Service. */
const str = (k: string, d = '') => (process.env[k] ?? d).trim()

export const env = {
  appUrl: str('APP_URL', process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:3000'),
  isProd: process.env.NODE_ENV === 'production',
  sessionHours: Number(str('SESSION_HOURS', '12')) || 12,
  s3: {
    bucket: str('BUCKET') || str('AWS_S3_BUCKET_NAME'),
    endpoint: str('ENDPOINT') || str('AWS_ENDPOINT_URL'),
    region: str('REGION') || str('AWS_DEFAULT_REGION') || 'auto',
    accessKeyId: str('ACCESS_KEY_ID') || str('AWS_ACCESS_KEY_ID'),
    secretAccessKey: str('SECRET_ACCESS_KEY') || str('AWS_SECRET_ACCESS_KEY'),
    forcePathStyle: str('S3_FORCE_PATH_STYLE', 'true') !== 'false',
  },
  oidc: {
    issuer: str('OIDC_ISSUER'),
    clientId: str('OIDC_CLIENT_ID'),
    clientSecret: str('OIDC_CLIENT_SECRET'),
    label: str('OIDC_LABEL', 'Single Sign-on'),
  },
  webauthnRpId: str('WEBAUTHN_RP_ID'),
  ai: {
    apiKey: str('ANTHROPIC_API_KEY'),
    model: str('AI_MODEL', 'claude-opus-5-5'),
  },
  /** Web Push (PRD §25): VAPID-Schlüsselpaar, erzeugen mit `npx web-push generate-vapid-keys`. */
  push: {
    publicKey: str('VAPID_PUBLIC_KEY'),
    privateKey: str('VAPID_PRIVATE_KEY'),
    subject: str('VAPID_SUBJECT'),
  },
}

export const storageConfigured = () => Boolean(env.s3.bucket && env.s3.endpoint && env.s3.accessKeyId && env.s3.secretAccessKey)
export const ssoConfigured = () => Boolean(env.oidc.issuer && env.oidc.clientId)
export const aiConfigured = () => Boolean(env.ai.apiKey)
export const pushConfigured = () => Boolean(env.push.publicKey && env.push.privateKey && /^(mailto:|https:)/.test(env.push.subject))
