"use client";

import { useEffect, useState } from "react";
import { requestJson } from "@/app/components/workspace-ui";

type PushState = "loading" | "unsupported" | "unconfigured" | "denied" | "off" | "on";

const hints: Record<PushState, string> = {
  loading: "Wird geprüft …",
  unsupported:
    "Dieser Browser unterstützt keine Push-Nachrichten. Auf dem iPhone zuerst CareOS zum Home-Bildschirm hinzufügen und von dort öffnen.",
  unconfigured: "Push-Nachrichten sind auf diesem Server noch nicht eingerichtet (VAPID-Schlüssel fehlen).",
  denied: "Mitteilungen sind für CareOS in den Browser- oder Geräteeinstellungen blockiert.",
  off: "Auf diesem Gerät ausgeschaltet.",
  on: "Auf diesem Gerät eingeschaltet. Abmelden beendet die Push-Nachrichten.",
};

function applicationServerKey(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function registration() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return null;
  return (await navigator.serviceWorker.getRegistration("/")) ?? null;
}

// Push-Nachrichten für dieses Gerät ein- und ausschalten (Einstellungen › Benachrichtigungen).
export default function PushControl({ onMessage }: { onMessage: (message: string) => void }) {
  const [state, setState] = useState<PushState>("loading");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const reg = await registration();
      if (!reg) return live && setState("unsupported");
      const subscription = await reg.pushManager.getSubscription();
      const query = subscription ? `?endpoint=${encodeURIComponent(subscription.endpoint)}` : "";
      const status = await requestJson<{ publicKey: string | null; subscribed: boolean }>(`/api/push${query}`);
      if (!live) return;
      setPublicKey(status.publicKey);
      setState(
        !status.publicKey
          ? "unconfigured"
          : Notification.permission === "denied"
            ? "denied"
            : status.subscribed
              ? "on"
              : "off",
      );
    })().catch(() => live && setState("unsupported"));
    return () => {
      live = false;
    };
  }, []);

  async function toggle(enable: boolean) {
    const reg = await registration();
    if (!reg || !publicKey) return;
    setBusy(true);
    try {
      if (enable) {
        if ((await Notification.requestPermission()) !== "granted") {
          setState("denied");
          return;
        }
        const subscription =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: applicationServerKey(publicKey),
          }));
        await requestJson("/api/push", { method: "POST", body: subscription.toJSON() });
        setState("on");
        onMessage("Push-Nachrichten auf diesem Gerät eingeschaltet");
      } else {
        const subscription = await reg.pushManager.getSubscription();
        if (subscription) {
          await requestJson("/api/push", { method: "DELETE", body: { endpoint: subscription.endpoint } });
          await subscription.unsubscribe();
        }
        setState("off");
        onMessage("Push-Nachrichten auf diesem Gerät ausgeschaltet");
      }
    } catch (reason) {
      onMessage(reason instanceof Error ? reason.message : "Push-Nachrichten konnten nicht geändert werden.");
    } finally {
      setBusy(false);
    }
  }

  const available = state === "on" || state === "off";
  return (
    <>
      <label className="settings-toggle">
        <span>Push-Nachrichten auf diesem Gerät</span>
        <input
          type="checkbox"
          checked={state === "on"}
          disabled={!available || busy}
          onChange={(event) => void toggle(event.target.checked)}
        />
        <i />
      </label>
      <p aria-live="polite">{hints[state]}</p>
    </>
  );
}
