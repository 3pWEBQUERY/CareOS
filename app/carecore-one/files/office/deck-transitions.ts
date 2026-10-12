import { TRANSITION_SPEEDS, type SlideTransition } from "@/lib/office/model";

// Folienübergänge als Animation (Web Animations): die neue Folie kommt von rechts bzw. blendet ein, die bisherige
// geht beim Schieben nach links. Wer im System weniger Bewegung eingestellt hat, sieht den Wechsel ohne Animation.

export const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const FRAMES: Record<SlideTransition["type"], { entering: Keyframe[]; leaving?: Keyframe[] }> = {
  fade: { entering: [{ opacity: 0 }, { opacity: 1 }] },
  push: {
    entering: [{ transform: "translateX(100%)" }, { transform: "translateX(0)" }],
    leaving: [{ transform: "translateX(0)" }, { transform: "translateX(-100%)" }],
  },
  wipe: { entering: [{ clipPath: "inset(0 0 0 100%)" }, { clipPath: "inset(0 0 0 0)" }] },
  cover: { entering: [{ transform: "translateX(100%)" }, { transform: "translateX(0)" }] },
};

export function playTransition(
  transition: SlideTransition,
  entering: HTMLElement | null,
  leaving: HTMLElement | null = null,
): Animation[] {
  if (!entering || reducedMotion() || typeof entering.animate !== "function") return [];
  const frames = FRAMES[transition.type];
  const options: KeyframeAnimationOptions = { duration: TRANSITION_SPEEDS[transition.speed].ms, easing: "ease-in-out" };
  return [
    entering.animate(frames.entering, options),
    ...(leaving && frames.leaving ? [leaving.animate(frames.leaving, { ...options, fill: "forwards" })] : []),
  ];
}
