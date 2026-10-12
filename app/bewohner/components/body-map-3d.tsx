"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import * as THREE from "three";
import { ArrowArcLeft, ArrowArcRight, ArrowCounterClockwise, Crosshair, Minus, Plus, X } from "@phosphor-icons/react";
import { CareOptionSelect } from "@/app/components/care-form-controls";
import { BODY_VIEWS, bodyRegion, nearestYaw, type BodySex } from "@/lib/body-regions";
import { BODY_REGION_POINTS } from "@/lib/body-region-points";

export type BodyPoint = { x: number; y: number; z: number };
export type BodyMapObservation = BodyPoint & {
  id: string;
  kind: "redness" | "wound" | "fracture" | "other";
  label: string;
  location?: string;
};

type Props = {
  gender: string | null | undefined;
  observations: BodyMapObservation[];
  selectedId: string | null;
  placing: boolean;
  // Ein Klick auf die Figur erfasst direkt einen Befund an dieser Stelle (ohne vorher „Befund hinzufügen“).
  quickPlace?: boolean;
  // Punkt des Befunds, der gerade erfasst wird (Vorschau am Modell).
  pending?: BodyPoint | null;
  onSelect: (id: string) => void;
  onPlace: (point: BodyPoint, region: string) => void;
  onCancelPlacing?: () => void;
};

export const BODY_KIND_COLORS: Record<BodyMapObservation["kind"], string> = {
  redness: "#ba7621",
  wound: "#cc4d41",
  fracture: "#285ddd",
  other: "#28746e",
};

const HEIGHT = 3.55;
const DEFAULT_FOCUS = 1.78;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3.4;
// Das weibliche Modell steht etwas hinter der Drehachse; für die Blickrichtung auf einen Punkt.
const Z_CENTER: Record<BodySex, number> = { female: -0.13, male: 0 };

type Hover = { left: number; top: number; text: string; tone: "region" | "marker" };

const degrees = (yaw: number) => Math.round((((THREE.MathUtils.radToDeg(yaw) % 360) + 360) % 360) / 5) * 5;

// Weicher Schatten unter den Füssen, damit das Modell im Raum steht.
function groundShadow() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 64);
    gradient.addColorStop(0, "rgba(31, 55, 92, 0.32)");
    gradient.addColorStop(1, "rgba(31, 55, 92, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  const texture = new THREE.CanvasTexture(canvas);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 0.75),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.002;
  return shadow;
}

function disposeGroup(group: THREE.Group) {
  group.children.forEach((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    }
  });
  group.clear();
}

export function BodyMap3D({
  gender,
  observations,
  selectedId,
  placing,
  quickPlace = false,
  pending,
  onSelect,
  onPlace,
  onCancelPlacing,
}: Props) {
  const sex: BodySex = gender === "female" ? "female" : "male";
  const containerRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onSelect, onPlace, placing: placing || quickPlace, observations });
  const markerRef = useRef<THREE.Group | null>(null);
  const pendingRef = useRef<THREE.Group | null>(null);
  const targetYaw = useRef(0);
  const targetZoom = useRef(1);
  const targetFocus = useRef(DEFAULT_FOCUS);
  const [angle, setAngle] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [supported, setSupported] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [modelError, setModelError] = useState("");
  const [hover, setHover] = useState<Hover | null>(null);

  useEffect(() => {
    callbacks.current = { onSelect, onPlace, placing: placing || quickPlace, observations };
  }, [onSelect, onPlace, placing, quickPlace, observations]);

  const setYaw = (yaw: number) => {
    targetYaw.current = yaw;
    setAngle(degrees(yaw));
  };
  const setZoomLevel = (value: number) => {
    targetZoom.current = THREE.MathUtils.clamp(value, MIN_ZOOM, MAX_ZOOM);
    if (targetZoom.current === 1) targetFocus.current = DEFAULT_FOCUS;
    setZoom(targetZoom.current);
  };

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
    } catch {
      const timer = window.setTimeout(() => setSupported(false), 0);
      return () => window.clearTimeout(timer);
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0xffffff, 0);
    host.prepend(renderer.domElement);
    renderer.domElement.setAttribute("aria-hidden", "true");

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1.45, 1.45, 2.05, -2.05, 0.1, 40);
    camera.position.set(0, DEFAULT_FOCUS, 8);
    camera.lookAt(0, DEFAULT_FOCUS, 0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xc9d3df, 1.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.9);
    key.position.set(-3, 5, 6);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xe4efff, 0.9);
    fill.position.set(4, 2, 3);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xdbe8ff, 1.3);
    rim.position.set(0, 3, -6);
    scene.add(rim);
    scene.add(groundShadow());

    const model = new THREE.Group();
    scene.add(model);
    const markerGroup = new THREE.Group();
    model.add(markerGroup);
    markerRef.current = markerGroup;
    const pendingGroup = new THREE.Group();
    model.add(pendingGroup);
    pendingRef.current = pendingGroup;
    // Vorschau der Körperstelle unter dem Zeiger beim Erfassen.
    const preview = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 0.75, depthTest: false }),
    );
    preview.renderOrder = 3;
    preview.visible = false;
    model.add(preview);

    let surface: THREE.Mesh | null = null;
    const controller = new AbortController();
    fetch(`/body-surfaces/${sex}.bin`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Körpermodell konnte nicht geladen werden.");
        const buffer = await response.arrayBuffer();
        const header = new DataView(buffer);
        const vertexCount = header.getUint32(0, true);
        const indexCount = header.getUint32(4, true);
        if (buffer.byteLength !== 8 + vertexCount * 18 + indexCount * 4)
          throw new Error("Körpermodell ist unvollständig.");
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(buffer, 8, vertexCount * 3), 3));
        geometry.setAttribute(
          "normal",
          new THREE.BufferAttribute(new Int16Array(buffer, 8 + vertexCount * 12, vertexCount * 3), 3, true),
        );
        geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(buffer, 8 + vertexCount * 18, indexCount), 1));
        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({ color: 0xe8e2dc, roughness: 0.72, metalness: 0, side: THREE.DoubleSide }),
        );
        mesh.scale.setScalar(HEIGHT / (sex === "female" ? 1.65778 : 1.71948));
        mesh.userData.body = true;
        if (controller.signal.aborted) {
          geometry.dispose();
          (mesh.material as THREE.Material).dispose();
          return;
        }
        model.add(mesh);
        surface = mesh;
        setModelError("");
        setLoaded(true);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setModelError(error instanceof Error ? error.message : "Körpermodell konnte nicht geladen werden.");
      });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    // Treffer unter dem Zeiger: Befundmarker oder Körperoberfläche (mit zur Kamera gerichteter Normale).
    const pick = (clientX: number, clientY: number) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.set(((clientX - bounds.left) / bounds.width) * 2 - 1, -((clientY - bounds.top) / bounds.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const markerHit = raycaster
        .intersectObjects(markerGroup.children, false)
        .find((hit) => typeof hit.object.userData.observationId === "string");
      if (markerHit) return { type: "marker" as const, markerId: markerHit.object.userData.observationId as string };
      if (!surface) return null;
      const hit = raycaster.intersectObject(surface, false)[0];
      if (!hit?.face) return null;
      const local = model.worldToLocal(hit.point.clone());
      const direction = raycaster.ray.direction.clone().applyQuaternion(model.quaternion.clone().invert());
      const normal = hit.face.normal.clone();
      if (normal.dot(direction) > 0) normal.negate();
      const point = { x: +local.x.toFixed(3), y: +local.y.toFixed(3), z: +local.z.toFixed(3) };
      return { type: "body" as const, point, region: bodyRegion(point, normal, sex) };
    };

    const pointers = new Map<number, { x: number; y: number }>();
    let drag: { x: number; y: number; yaw: number; focus: number; moved: boolean } | null = null;
    let pinch: { distance: number; zoom: number } | null = null;
    let hoverFrame = 0;
    const distance = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const updateHover = (clientX: number, clientY: number) => {
      cancelAnimationFrame(hoverFrame);
      hoverFrame = requestAnimationFrame(() => {
        const result = pick(clientX, clientY);
        const bounds = host.getBoundingClientRect();
        const position = { left: clientX - bounds.left, top: clientY - bounds.top };
        if (result?.type === "marker") {
          const observation = callbacks.current.observations.find((item) => item.id === result.markerId);
          preview.visible = false;
          renderer.domElement.style.cursor = "pointer";
          setHover(
            observation
              ? {
                  ...position,
                  tone: "marker",
                  text: [observation.label, observation.location].filter(Boolean).join(" · "),
                }
              : null,
          );
        } else if (result && callbacks.current.placing) {
          preview.position.set(result.point.x, result.point.y, result.point.z);
          preview.visible = true;
          renderer.domElement.style.cursor = "crosshair";
          setHover({ ...position, tone: "region", text: result.region });
        } else {
          preview.visible = false;
          renderer.domElement.style.cursor = "";
          setHover(null);
        }
      });
    };
    const pointerDown = (event: PointerEvent) => {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      renderer.domElement.setPointerCapture(event.pointerId);
      if (pointers.size === 2) {
        pinch = { distance: distance(), zoom: targetZoom.current };
        drag = null;
      } else if (pointers.size === 1)
        drag = { x: event.clientX, y: event.clientY, yaw: targetYaw.current, focus: targetFocus.current, moved: false };
    };
    const pointerMove = (event: PointerEvent) => {
      if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinch && pointers.size === 2) {
        targetZoom.current = THREE.MathUtils.clamp((pinch.zoom * distance()) / pinch.distance, MIN_ZOOM, MAX_ZOOM);
        setZoom(+targetZoom.current.toFixed(2));
        return;
      }
      if (drag) {
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > 4) {
          drag.moved = true;
          preview.visible = false;
          setHover(null);
        }
        if (drag.moved) {
          targetYaw.current = drag.yaw + dx * 0.011;
          // Vergrössert lässt sich der Ausschnitt nach oben und unten verschieben.
          if (targetZoom.current > 1.05)
            targetFocus.current = THREE.MathUtils.clamp(
              drag.focus + (dy / host.clientHeight) * (4.1 / targetZoom.current),
              0.35,
              3.25,
            );
          setAngle(degrees(targetYaw.current));
        }
        return;
      }
      if (event.pointerType === "mouse") updateHover(event.clientX, event.clientY);
    };
    const pointerUp = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pinch) {
        if (pointers.size < 2) pinch = null;
        drag = null;
        return;
      }
      const current = drag;
      drag = null;
      if (!current || current.moved) return;
      const result = pick(event.clientX, event.clientY);
      if (!result) return;
      if (result.type === "marker") callbacks.current.onSelect(result.markerId);
      else if (callbacks.current.placing) {
        preview.visible = false;
        setHover(null);
        callbacks.current.onPlace(result.point, result.region);
      }
    };
    const pointerLeave = () => {
      cancelAnimationFrame(hoverFrame);
      preview.visible = false;
      renderer.domElement.style.cursor = "";
      setHover(null);
    };
    // Mausrad scrollt die Akte; vergrössert wird mit Strg/⌘ + Mausrad oder der Zwei-Finger-Geste.
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      targetZoom.current = THREE.MathUtils.clamp(
        targetZoom.current * Math.exp(-event.deltaY * 0.004),
        MIN_ZOOM,
        MAX_ZOOM,
      );
      if (targetZoom.current === 1) targetFocus.current = DEFAULT_FOCUS;
      setZoom(+targetZoom.current.toFixed(2));
    };
    const canvas = renderer.domElement;
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerUp);
    canvas.addEventListener("pointerleave", pointerLeave);
    canvas.addEventListener("wheel", wheel, { passive: false });

    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      const aspect = width / height;
      camera.left = -2.05 * aspect;
      camera.right = 2.05 * aspect;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let frame = 0;
    const render = (time: number) => {
      model.rotation.y += (targetYaw.current - model.rotation.y) * 0.15;
      camera.zoom += (targetZoom.current - camera.zoom) * 0.16;
      camera.position.y += (targetFocus.current - camera.position.y) * 0.15;
      camera.lookAt(0, camera.position.y, 0);
      camera.updateProjectionMatrix();
      // Ausgewählter Befund und Vorschau pulsieren leicht.
      const pulse = 1 + Math.sin(time / 260) * 0.14;
      markerGroup.children.forEach((child) => {
        if (child.userData.pulse) child.scale.setScalar(pulse);
      });
      pendingGroup.children.forEach((child) => child.scale.setScalar(pulse));
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);

    return () => {
      controller.abort();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(hoverFrame);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerUp);
      canvas.removeEventListener("pointerleave", pointerLeave);
      canvas.removeEventListener("wheel", wheel);
      canvas.remove();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const material = object.material as THREE.MeshBasicMaterial;
          material.map?.dispose();
          material.dispose();
        }
      });
      renderer.dispose();
      markerRef.current = null;
      pendingRef.current = null;
      setLoaded(false);
    };
  }, [sex]);

  // Befundmarker: Punkt mit Hof; ein blasser Schatten bleibt auch durch den Körper hindurch sichtbar,
  // damit Befunde auf der abgewandten Seite nicht übersehen werden.
  useEffect(() => {
    const group = markerRef.current;
    if (!group) return;
    disposeGroup(group);
    for (const observation of observations) {
      const selected = observation.id === selectedId;
      const color = new THREE.Color(BODY_KIND_COLORS[observation.kind]);
      const position = new THREE.Vector3(observation.x, observation.y, observation.z);
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(selected ? 0.05 : 0.038, 20, 14),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, roughness: 0.35 }),
      );
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(selected ? 0.085 : 0.062, 20, 14),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: selected ? 0.24 : 0.14, depthWrite: false }),
      );
      const ghost = new THREE.Mesh(
        new THREE.SphereGeometry(0.036, 16, 12),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthTest: false, depthWrite: false }),
      );
      ghost.renderOrder = 2;
      for (const mesh of [dot, halo, ghost]) {
        mesh.position.copy(position);
        mesh.userData.observationId = observation.id;
        mesh.userData.pulse = selected && mesh !== ghost;
        group.add(mesh);
      }
    }
  }, [observations, selectedId, sex, loaded]);

  // Vorschau des Befunds, der gerade erfasst wird.
  useEffect(() => {
    const group = pendingRef.current;
    if (!group) return;
    disposeGroup(group);
    if (!pending) return;
    const ring = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 0.55, depthTest: false }),
    );
    ring.renderOrder = 3;
    ring.position.set(pending.x, pending.y, pending.z);
    group.add(ring);
  }, [pending, sex, loaded]);

  // Ausgewählten Befund zur Kamera drehen und heranholen (nur beim Wechsel der Auswahl, damit eigenes
  // Drehen danach erhalten bleibt).
  const selected = observations.find((item) => item.id === selectedId);
  const selectedKey = selected ? `${selected.id}:${selected.x}:${selected.y}:${selected.z}` : null;
  useEffect(() => {
    if (!selectedKey) return;
    const observation = callbacks.current.observations.find((item) => selectedKey.startsWith(`${item.id}:`));
    if (!observation) return;
    const yaw = -Math.atan2(observation.x, observation.z - Z_CENTER[sex] || 0.001);
    targetYaw.current = nearestYaw(targetYaw.current, yaw);
    targetZoom.current = Math.max(targetZoom.current, 2.1);
    targetFocus.current = THREE.MathUtils.clamp(observation.y, 0.45, 3.2);
    const timer = window.setTimeout(() => {
      setAngle(degrees(targetYaw.current));
      setZoom(targetZoom.current);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedKey, sex]);

  const rotate = (delta: number) => setYaw(targetYaw.current + THREE.MathUtils.degToRad(delta));
  const showView = (yaw: number) => setYaw(nearestYaw(targetYaw.current, yaw));
  const reset = () => {
    setYaw(nearestYaw(targetYaw.current, 0));
    targetZoom.current = 1;
    targetFocus.current = DEFAULT_FOCUS;
    setZoom(1);
  };
  const activeView = BODY_VIEWS.find((view) => {
    const difference = Math.abs(((angle - degrees(view.yaw) + 540) % 360) - 180);
    return difference <= 20;
  })?.id;

  // Tastatur am Modell: Pfeile drehen/verschieben, +/− vergrössern, 0 setzt zurück, Escape bricht ab.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const actions: Record<string, () => void> = {
      ArrowLeft: () => rotate(-45),
      ArrowRight: () => rotate(45),
      ArrowUp: () => {
        targetFocus.current = THREE.MathUtils.clamp(targetFocus.current + 0.35, 0.35, 3.25);
      },
      ArrowDown: () => {
        targetFocus.current = THREE.MathUtils.clamp(targetFocus.current - 0.35, 0.35, 3.25);
      },
      "+": () => setZoomLevel(targetZoom.current + 0.4),
      "=": () => setZoomLevel(targetZoom.current + 0.4),
      "-": () => setZoomLevel(targetZoom.current - 0.4),
      "0": reset,
    };
    if (event.key === "Escape" && placing) {
      event.preventDefault();
      onCancelPlacing?.();
    } else if (actions[event.key] && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      actions[event.key]();
    }
  };

  const regionOptions = BODY_REGION_POINTS[sex]
    .map(([region]) => ({ value: region, label: region }))
    .sort((a, b) => a.label.localeCompare(b.label, "de-CH"));
  const chooseRegion = (region: string) => {
    const entry = BODY_REGION_POINTS[sex].find(([name]) => name === region);
    if (!entry) return;
    const [, view, x, y, z] = entry;
    showView(BODY_VIEWS.find((item) => item.id === view)?.yaw ?? 0);
    onPlace({ x, y, z }, region);
  };
  const unavailable = !supported || Boolean(modelError);

  return (
    <div className="clinical-body-viewer">
      <div className="clinical-body-views" role="group" aria-label="Ansicht wählen">
        {BODY_VIEWS.map((view) => (
          <button
            type="button"
            key={view.id}
            className={activeView === view.id ? "active" : ""}
            aria-pressed={activeView === view.id}
            onClick={() => showView(view.yaw)}
            disabled={unavailable}
          >
            {view.label}
          </button>
        ))}
      </div>
      <div
        className={`clinical-body-canvas ${placing ? "placing" : ""}`}
        ref={containerRef}
        tabIndex={unavailable ? -1 : 0}
        role="application"
        aria-roledescription="3D-Körpermodell"
        aria-label={
          placing
            ? "Körpermodell: Körperstelle anklicken oder unten aus der Liste wählen. Escape bricht ab."
            : quickPlace
              ? "Körpermodell: Körperstelle anklicken, um einen Befund zu erfassen. Pfeiltasten drehen, Plus und Minus vergrössern, 0 setzt zurück."
              : "Körpermodell: Pfeiltasten drehen, Plus und Minus vergrössern, 0 setzt zurück."
        }
        onKeyDown={onKeyDown}
      >
        {!loaded && !unavailable && <p className="clinical-body-status">Körpermodell wird geladen…</p>}
        {unavailable && (
          <p className="clinical-body-status" role="alert">
            {modelError || "Die 3D-Ansicht ist auf diesem Gerät nicht verfügbar."}{" "}
            {placing ? "Körperstelle bitte unten aus der Liste wählen." : ""}
          </p>
        )}
        {hover && (
          <span
            className={`clinical-body-tooltip ${hover.tone}`}
            style={{ left: hover.left, top: hover.top }}
            aria-hidden="true"
          >
            {hover.text}
          </span>
        )}
      </div>
      {placing && (
        <div className="clinical-body-placing" role="status">
          <span>
            <Crosshair aria-hidden="true" />
            <strong>Körperstelle am Modell anklicken</strong>
          </span>
          <div>
            <CareOptionSelect
              label="Körperstelle aus Liste wählen"
              placeholder="oder aus Liste wählen"
              value=""
              options={regionOptions}
              onChange={chooseRegion}
              menuZIndex={120}
            />
            {onCancelPlacing && (
              <button type="button" onClick={onCancelPlacing} aria-label="Erfassen abbrechen">
                <X aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      )}
      <div className="clinical-body-toolbar" aria-label="Körperansicht steuern">
        <button type="button" onClick={() => rotate(-45)} aria-label="Nach links drehen" disabled={unavailable}>
          <ArrowArcLeft aria-hidden="true" />
        </button>
        <button type="button" onClick={() => rotate(45)} aria-label="Nach rechts drehen" disabled={unavailable}>
          <ArrowArcRight aria-hidden="true" />
        </button>
        <i aria-hidden="true" />
        <button
          type="button"
          onClick={() => setZoomLevel(targetZoom.current - 0.4)}
          aria-label="Verkleinern"
          disabled={unavailable || zoom <= MIN_ZOOM}
        >
          <Minus aria-hidden="true" />
        </button>
        <span aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          onClick={() => setZoomLevel(targetZoom.current + 0.4)}
          aria-label="Vergrössern"
          disabled={unavailable || zoom >= MAX_ZOOM}
        >
          <Plus aria-hidden="true" />
        </button>
        <i aria-hidden="true" />
        <button type="button" onClick={reset} aria-label="Ansicht zurücksetzen" disabled={unavailable}>
          <ArrowCounterClockwise aria-hidden="true" />
        </button>
      </div>
      <p className="clinical-body-hint">
        {placing
          ? "Beim Überfahren zeigt das Modell die Körperstelle an. Escape bricht ab."
          : quickPlace
            ? "Stelle anklicken erfasst einen Befund · Ziehen dreht · Strg + Mausrad oder zwei Finger zoomen"
            : "Ziehen dreht · vergrössert ziehen verschiebt · Strg + Mausrad oder zwei Finger zoomen"}
      </p>
    </div>
  );
}
