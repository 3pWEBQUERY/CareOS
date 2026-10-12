# SSO über OpenID Connect

CareOS meldet Mitarbeitende auf Wunsch über den Identity-Provider (IdP) der Einrichtung an. Umgesetzt ist das
selbst, mit Open-Source-Bausteinen: [openid-client](https://github.com/panva/openid-client) (MIT, OpenID-zertifiziert).
Es funktioniert mit jedem Anbieter, der OpenID Connect spricht, zum Beispiel Keycloak, Authentik, Microsoft Entra ID,
Google Workspace oder HIN.

## Einrichten

1. Beim IdP eine Anwendung (Client, vertraulich) anlegen und diese Rücksprungadresse eintragen:
   `https://<CareOS-Adresse>/api/auth/sso/callback`. Sie steht auch auf der Karte in CareOS.
2. In CareOS unter **Leitung › Konfiguration › SSO (OpenID Connect)** folgende Angaben eintragen:
   - Adresse des IdP (Issuer), Client-ID und Client-Secret.
   - Welcher Claim dem CareOS-Benutzernamen entspricht: `preferred_username`, `email`, `upn` oder `sub`.
   - Die Bezeichnung für den Knopf auf der Anmeldeseite.
3. Mit **Verbindung prüfen** testen, ob CareOS das Discovery-Dokument des IdP lesen kann, dann einschalten.

## Ablauf und Sicherheit

- **Verfahren:**
  - Authorization Code mit PKCE (S256), `state` und `nonce`.
  - Das ID-Token wird geprüft: Signatur über die JWKS des IdP, Aussteller, Empfänger, Ablauf und `nonce`.
  - Eine laufende Anmeldung gilt 10 Minuten, nur einmal und ist nur als Hash des `state` gespeichert.
- **Konten:** Angemeldet werden nur bestehende, aktive Konten der Einrichtung, deren Benutzername (ohne Beachtung von
  Gross- und Kleinschreibung) dem gewählten Claim entspricht. Konten entstehen nicht automatisch. Gesperrte,
  archivierte und fremde Konten werden abgewiesen.
- **Zwei-Faktor-Anmeldung** übernimmt bei SSO der IdP.
- **Client-Secret:** Es liegt verschlüsselt in der Datenbank (AES-256-GCM, Schlüssel aus `CARECORE_MFA_KEY`) und wird
  nie angezeigt.
- **Nur https:**
  - Der IdP muss über `https` erreichbar sein.
  - Einzige Ausnahme sind die automatischen Tests. Dort gilt `CARECORE_SSO_ALLOW_HTTP=1`, und das nur für `localhost`.
- **Protokoll:** Jede Anmeldung über SSO (`sso_login`) und jede Änderung der Einstellungen wird protokolliert.
- **Anmeldeseite:** Der Knopf „Mit … anmelden“ erscheint nur, wenn SSO eingeschaltet ist. Sonst bleibt die Seite
  unverändert.
