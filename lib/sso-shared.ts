// SSO über OpenID Connect: gemeinsame Typen für Server und Konfiguration.
export const SSO_CLAIMS = {
  preferred_username: "Benutzername (preferred_username)",
  email: "E-Mail (email)",
  upn: "UPN (Microsoft Entra ID)",
  sub: "Kennung (sub)",
} as const;
export type SsoClaim = keyof typeof SSO_CLAIMS;

export type SsoSettings = {
  enabled: boolean;
  issuer: string;
  clientId: string;
  hasSecret: boolean;
  usernameClaim: SsoClaim;
  buttonLabel: string;
  updatedAt: string | null;
};
