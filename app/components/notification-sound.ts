// Kurzer, leiser Zweiklang für neue Benachrichtigungen (Einstellungen › Benachrichtigungen › „Hinweiston“).
// Ohne Audiodatei; der Browser spielt ihn erst nach einer ersten Bedienung der Seite ab.
export function playNotificationSound() {
  const AudioContextClass = window.AudioContext;
  if (!AudioContextClass) return;
  try {
    const context = new AudioContextClass();
    const gain = context.createGain();
    gain.connect(context.destination);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.5);
    [880, 1175].forEach((frequency, index) => {
      const tone = context.createOscillator();
      tone.type = "sine";
      tone.frequency.value = frequency;
      tone.connect(gain);
      tone.start(context.currentTime + index * 0.14);
      tone.stop(context.currentTime + 0.5);
    });
    window.setTimeout(() => void context.close(), 800);
  } catch {
    // Kein Ton möglich (z. B. Audio blockiert): die Benachrichtigung erscheint trotzdem.
  }
}
