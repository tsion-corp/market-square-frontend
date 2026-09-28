"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/cn";

/**
 * A LIGHT PHOTO EDITOR FOR THE SEND REVIEW — crop, stickers, text and draw over
 * a shot before it goes, the flow every messenger has (ogazboiz, 2026-09-27).
 *
 * Layers sit over the photo: freehand strokes (an SVG in a 0..1 viewBox, so a
 * stroke keeps its place at any size), draggable text, and draggable emoji
 * stickers. Nothing is baked until send: `exportImage()` composites the working
 * photo and every layer onto a canvas at natural size and hands back a File, or
 * null when nothing changed — so an untouched shot sends its original bytes.
 *
 * CROP is applied eagerly: it flattens everything to a canvas, cuts the chosen
 * rectangle, and that becomes the new WORKING image (already un-mirrored and
 * with the annotations baked), so coordinates for anything drawn afterwards map
 * cleanly to the cropped picture. Coordinates are normalised 0..1 of the display
 * box, which is why they survive the on-screen scale and the natural export.
 *
 * VIDEO uses the same layers (draw / text / stickers; crop is photo-only). On
 * send `exportVideo()` replays the clip through a canvas, paints the layers on
 * every frame and records it back — real-time, and null on any failure so an
 * untouched or unbakeable clip sends its original bytes.
 */

type Tool = "none" | "draw" | "text" | "sticker" | "crop";
type Point = { x: number; y: number };
type Stroke = { color: string; points: Point[] };
type TextLayer = { id: string; text: string; x: number; y: number; color: string };
type Sticker = { id: string; emoji: string; x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

const COLORS = ["#FFFFFF", "#111111", "#E84A4A", "#9F65FD", "#F5C518", "#4ADE80", "#3B82F6"];
const STICKERS = [
  "😂", "❤️", "🔥", "😍", "😭", "🙏", "👍", "🎉", "✨", "😎",
  "🥰", "😢", "😱", "💀", "👀", "💯", "🙌", "😅", "🤔", "😮",
  "🥳", "😴", "🤝", "💪", "🌍", "⚡", "🌸", "⭐", "🎶", "☀️",
];
const STROKE_PX = 5;
const TEXT_PX = 26;
const STICKER_PX = 52;

export interface MediaEditorHandle {
  hasEdits: () => boolean;
  /** The photo with every layer baked in, or null when untouched. */
  exportImage: () => Promise<{ file: File; url: string } | null>;
}

export const MediaEditor = forwardRef<
  MediaEditorHandle,
  { src: string; mirrored?: boolean; fileName: string; kind?: "photo" | "video"; className?: string }
>(function MediaEditor({ src, mirrored = false, fileName, kind = "photo", className }, ref) {
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  // The image's actual drawn rectangle inside the box. With object-contain a
  // non-3:4 gallery photo is letterboxed, so every layer and every pointer must
  // be mapped to THIS rect (not the box) or a stroke lands off the picture.
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const natRef = useRef<{ w: number; h: number } | null>(null);
  const recompute = useCallback(() => {
    const box = boxRef.current;
    const nat = natRef.current;
    if (!box || !nat || nat.h === 0) return;
    const cw = box.clientWidth;
    const ch = box.clientHeight;
    const na = nat.w / nat.h;
    const width = cw / ch > na ? ch * na : cw;
    const height = cw / ch > na ? ch : cw / na;
    setRect({ left: (cw - width) / 2, top: (ch - height) / 2, width, height });
  }, []);
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(recompute);
    ro.observe(box);
    return () => ro.disconnect();
  }, [recompute]);

  // The WORKING image: the original until a crop replaces it with a flattened,
  // un-mirrored cut. Created object URLs are tracked so they can be revoked.
  const [working, setWorking] = useState<{ url: string; mirrored: boolean; owned: boolean }>({
    url: src,
    mirrored,
    owned: false,
  });
  const [tool, setTool] = useState<Tool>("none");
  const [color, setColor] = useState<string>(COLORS[0]!);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [texts, setTexts] = useState<TextLayer[]>([]);
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [live, setLive] = useState<Stroke | null>(null);
  const [cropRect, setCropRect] = useState<Rect>({ x: 0.08, y: 0.08, w: 0.84, h: 0.84 });
  const [cropped, setCropped] = useState(false);
  const dragText = useRef<{ id: string; dx: number; dy: number; kind: "text" | "sticker" } | null>(null);
  const cropDrag = useRef<{ mode: "move" | "nw" | "ne" | "sw" | "se"; start: Point; rect: Rect } | null>(null);

  // Revoke any crop-created object URL on unmount (retake / close) so it does
  // not leak; the one handed to the caller on send is theirs to revoke. The
  // ref is assigned in an effect — refs may not be written during render
  // (react-hooks/refs) — and the unmount cleanup reads whatever was current.
  const workingRef = useRef(working);
  useEffect(() => {
    workingRef.current = working;
  });
  useEffect(
    () => () => {
      if (workingRef.current.owned) URL.revokeObjectURL(workingRef.current.url);
    },
    []
  );

  const norm = useCallback(
    (clientX: number, clientY: number): Point => {
      const box = boxRef.current?.getBoundingClientRect();
      if (!box || !rect || rect.width === 0 || rect.height === 0) return { x: 0.5, y: 0.5 };
      return {
        x: Math.min(1, Math.max(0, (clientX - box.left - rect.left) / rect.width)),
        y: Math.min(1, Math.max(0, (clientY - box.top - rect.top) / rect.height)),
      };
    },
    [rect]
  );

  // ── Drawing ────────────────────────────────────────────────────────────────
  const onBoxPointerDown = (e: React.PointerEvent) => {
    if (tool !== "draw") return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setLive({ color, points: [norm(e.clientX, e.clientY)] });
  };
  const onBoxPointerMove = (e: React.PointerEvent) => {
    if (tool === "draw" && live) {
      setLive({ color: live.color, points: [...live.points, norm(e.clientX, e.clientY)] });
      return;
    }
    // Dragging a text / sticker.
    const d = dragText.current;
    if (d) {
      const p = norm(e.clientX, e.clientY);
      const move = (list: Array<{ id: string; x: number; y: number }>) =>
        list.map((t) => (t.id === d.id ? { ...t, x: p.x + d.dx, y: p.y + d.dy } : t));
      if (d.kind === "text") setTexts((l) => move(l) as TextLayer[]);
      else setStickers((l) => move(l) as Sticker[]);
      return;
    }
    // Dragging the crop rectangle.
    if (cropDrag.current) updateCrop(norm(e.clientX, e.clientY));
  };
  const onBoxPointerUp = () => {
    if (live) {
      if (live.points.length > 1) setStrokes((s) => [...s, live]);
      setLive(null);
    }
    dragText.current = null;
    cropDrag.current = null;
  };

  // ── Text & stickers ──────────────────────────────────────────────────────
  const addText = () => {
    // Don't stack a new box while one is still being placed — finish it first.
    if (editingId) {
      setEditingId(null);
      return;
    }
    const id = `t-${Math.round(performance.now())}`;
    // Staggered DOWN FROM THE TOP so repeated adds don't pile dead-centre over
    // the subject; each stays where it is dropped and can be dragged after.
    const y = 0.22 + (texts.length % 4) * 0.12;
    setTexts((t) => [...t, { id, text: "", x: 0.5, y, color }]);
    setEditingId(id);
    setTool("text");
  };
  const addSticker = (emoji: string) => {
    setStickers((s) => [...s, { id: `s-${Math.round(performance.now())}`, emoji, x: 0.5, y: 0.5 }]);
  };
  const startDrag = (
    e: React.PointerEvent,
    layer: { id: string; x: number; y: number },
    kind: "text" | "sticker"
  ) => {
    if (kind === "text" && editingId === layer.id) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = norm(e.clientX, e.clientY);
    dragText.current = { id: layer.id, dx: layer.x - p.x, dy: layer.y - p.y, kind };
  };

  // ── Crop ─────────────────────────────────────────────────────────────────
  const startCrop = (e: React.PointerEvent, mode: "move" | "nw" | "ne" | "sw" | "se") => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    cropDrag.current = { mode, start: norm(e.clientX, e.clientY), rect: cropRect };
  };
  const updateCrop = (p: Point) => {
    const d = cropDrag.current;
    if (!d) return;
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    const r = { ...d.rect };
    const MIN = 0.12;
    if (d.mode === "move") {
      r.x = Math.min(1 - r.w, Math.max(0, d.rect.x + dx));
      r.y = Math.min(1 - r.h, Math.max(0, d.rect.y + dy));
    } else {
      const right = d.rect.x + d.rect.w;
      const bottom = d.rect.y + d.rect.h;
      if (d.mode === "nw") {
        r.x = Math.min(right - MIN, Math.max(0, d.rect.x + dx));
        r.y = Math.min(bottom - MIN, Math.max(0, d.rect.y + dy));
        r.w = right - r.x;
        r.h = bottom - r.y;
      } else if (d.mode === "ne") {
        r.y = Math.min(bottom - MIN, Math.max(0, d.rect.y + dy));
        r.w = Math.min(1 - d.rect.x, Math.max(MIN, d.rect.w + dx));
        r.h = bottom - r.y;
      } else if (d.mode === "sw") {
        r.x = Math.min(right - MIN, Math.max(0, d.rect.x + dx));
        r.w = right - r.x;
        r.h = Math.min(1 - d.rect.y, Math.max(MIN, d.rect.h + dy));
      } else {
        r.w = Math.min(1 - d.rect.x, Math.max(MIN, d.rect.w + dx));
        r.h = Math.min(1 - d.rect.y, Math.max(MIN, d.rect.h + dy));
      }
    }
    setCropRect(r);
  };
  const applyCrop = async () => {
    const flat = await renderFull();
    if (!flat) return;
    const cx = Math.round(cropRect.x * flat.width);
    const cy = Math.round(cropRect.y * flat.height);
    const cw = Math.max(1, Math.round(cropRect.w * flat.width));
    const ch = Math.max(1, Math.round(cropRect.h * flat.height));
    const out = document.createElement("canvas");
    out.width = cw;
    out.height = ch;
    out.getContext("2d")?.drawImage(flat, cx, cy, cw, ch, 0, 0, cw, ch);
    const blob = await toJpeg(out);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    if (working.owned) URL.revokeObjectURL(working.url);
    setWorking({ url, mirrored: false, owned: true }); // annotations are baked in now
    setStrokes([]);
    setTexts([]);
    setStickers([]);
    setCropped(true);
    setTool("none");
    setCropRect({ x: 0.08, y: 0.08, w: 0.84, h: 0.84 });
  };

  const undo = () => {
    if (editingId) {
      setTexts((t) => t.filter((x) => x.id !== editingId || x.text.trim() !== ""));
      setEditingId(null);
      return;
    }
    if (stickers.length > 0) return setStickers((s) => s.slice(0, -1));
    if (strokes.length > 0) return setStrokes((s) => s.slice(0, -1));
    setTexts((t) => t.slice(0, -1));
  };

  // Paint every drawn layer (strokes, text, stickers) onto a context at natural
  // size — shared by the photo canvas export and the per-frame video re-encode.
  const drawLayers = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number, scale: number) => {
      ctx.save();
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.lineWidth = STROKE_PX * scale;
      for (const stroke of strokes) {
        if (stroke.points.length < 2) continue;
        ctx.strokeStyle = stroke.color;
        ctx.beginPath();
        stroke.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x * w, p.y * h) : ctx.lineTo(p.x * w, p.y * h)));
        ctx.stroke();
      }
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = 6 * scale;
      ctx.font = `600 ${TEXT_PX * scale}px Geist, system-ui, sans-serif`;
      for (const t of texts) {
        if (!t.text.trim()) continue;
        ctx.fillStyle = t.color;
        ctx.fillText(t.text, t.x * w, t.y * h);
      }
      ctx.font = `${STICKER_PX * scale}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
      for (const s of stickers) ctx.fillText(s.emoji, s.x * w, s.y * h);
      ctx.restore();
    },
    [strokes, texts, stickers]
  );

  // Flatten the working image + every layer onto a canvas at natural size.
  const renderFull = useCallback(async (): Promise<HTMLCanvasElement | null> => {
    const img = await loadImage(working.url);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    // Strokes/text sized on screen against the image's drawn width, so bake them
    // scaled by natural / drawn — not the (possibly letterboxed) box width.
    const displayW = rect?.width || boxRef.current?.clientWidth || w;
    const scale = w / displayW;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.save();
    if (working.mirrored) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(img, 0, 0, w, h);
    ctx.restore();
    drawLayers(ctx, w, h, scale);
    return canvas;
  }, [working, drawLayers, rect]);

  // Bake the layers onto the CLIP by replaying it through a canvas and recording
  // the canvas (with the original audio) back to a file. Real-time: it takes the
  // clip's own length. Any failure resolves null so the caller sends the
  // untouched original rather than nothing.
  const exportVideo = useCallback(async (): Promise<{ file: File; url: string } | null> => {
    if (typeof MediaRecorder === "undefined" || typeof document === "undefined") return null;
    const w = natRef.current?.w;
    const h = natRef.current?.h;
    if (!w || !h) return null;
    const displayW = rect?.width || boxRef.current?.clientWidth || w;
    const scale = w / displayW;
    const src = document.createElement("video");
    src.src = working.url;
    src.muted = false;
    src.playsInline = true;
    try {
      await new Promise<void>((resolve, reject) => {
        src.onloadedmetadata = () => resolve();
        src.onerror = () => reject(new Error("clip load failed"));
      });
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      const mime = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
        "video/mp4",
      ].find((m) => MediaRecorder.isTypeSupported(m));
      const canvasStream = canvas.captureStream(30);
      // Keep the original soundtrack: pull the clip's audio track into the mix.
      const withCapture = src as HTMLVideoElement & { captureStream?: () => MediaStream };
      const audioTracks = withCapture.captureStream?.().getAudioTracks() ?? [];
      const outStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);
      const recorder = new MediaRecorder(outStream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      const recorded = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
      });
      let raf = 0;
      const paint = () => {
        ctx.save();
        if (working.mirrored) {
          ctx.translate(w, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(src, 0, 0, w, h);
        ctx.restore();
        drawLayers(ctx, w, h, scale);
        raf = requestAnimationFrame(paint);
      };
      recorder.start();
      await src.play();
      paint();
      await new Promise<void>((resolve) => {
        src.onended = () => resolve();
      });
      cancelAnimationFrame(raf);
      recorder.stop();
      const blob = await recorded;
      if (blob.size === 0) return null;
      const ext = recorder.mimeType.includes("mp4") ? "mp4" : "webm";
      const outName = fileName.replace(/\.[^.]+$/, "") + "." + ext;
      const file = new File([blob], outName, { type: blob.type });
      return { file, url: URL.createObjectURL(file) };
    } catch {
      return null;
    } finally {
      src.pause();
      src.removeAttribute("src");
      src.load();
    }
  }, [working, drawLayers, rect, fileName]);

  const hasEdits = () =>
    cropped || strokes.length > 0 || stickers.length > 0 || texts.some((t) => t.text.trim() !== "");

  useImperativeHandle(
    ref,
    () => ({
      hasEdits,
      exportImage: async () => {
        if (!hasEdits()) return null;
        if (kind === "video") return exportVideo();
        const canvas = await renderFull();
        if (!canvas) return null;
        const blob = await toJpeg(canvas);
        if (!blob) return null;
        const file = new File([blob], fileName, { type: "image/jpeg" });
        return { file, url: URL.createObjectURL(file) };
      },
    }),
    [kind, renderFull, exportVideo, fileName, cropped, strokes, texts, stickers]
  );

  const swatchesShown = tool === "draw" || tool === "text" || editingId !== null;

  return (
    <div className={cn("relative h-full w-full select-none", className)}>
      <div
        ref={boxRef}
        className="relative h-full w-full overflow-hidden"
        onPointerDown={onBoxPointerDown}
        onPointerMove={onBoxPointerMove}
        onPointerUp={onBoxPointerUp}
        onPointerCancel={onBoxPointerUp}
        style={{ touchAction: tool === "draw" || tool === "crop" ? "none" : undefined, cursor: tool === "draw" ? "crosshair" : undefined }}
      >
        {kind === "video" ? (
          <video
            ref={videoRef}
            src={working.url}
            autoPlay
            loop
            muted
            playsInline
            onLoadedMetadata={(e) => {
              natRef.current = { w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight };
              recompute();
            }}
            className={cn("pointer-events-none h-full w-full object-contain", working.mirrored && "-scale-x-100")}
          />
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element -- a just-captured local blob, no host */
          <img
            src={working.url}
            alt="Your capture"
            draggable={false}
            onLoad={(e) => {
              natRef.current = { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight };
              recompute();
            }}
            className={cn("pointer-events-none h-full w-full object-contain", working.mirrored && "-scale-x-100")}
          />
        )}

        {/* Every layer lives INSIDE the image's drawn rectangle, so a letterboxed
            gallery photo annotates in the right place. */}
        {rect && (
        <div className="absolute" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
        {/* Strokes. */}
        <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
          {[...strokes, ...(live ? [live] : [])].map((stroke, i) =>
            stroke.points.length > 1 ? (
              <polyline
                key={i}
                points={stroke.points.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke={stroke.color}
                strokeWidth={STROKE_PX}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ) : null
          )}
        </svg>

        {/* Text layers. */}
        {texts.map((t) => (
          <div
            key={t.id}
            onPointerDown={(e) => startDrag(e, t, "text")}
            className="absolute -translate-x-1/2 -translate-y-1/2 cursor-move"
            style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%` }}
          >
            {editingId === t.id ? (
              <input
                autoFocus
                value={t.text}
                onChange={(e) => setTexts((l) => l.map((x) => (x.id === t.id ? { ...x, text: e.target.value } : x)))}
                onBlur={() => {
                  setEditingId(null);
                  setTexts((l) => l.filter((x) => x.text.trim() !== "" || x.id !== t.id));
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                placeholder="Type…"
                className="min-w-[2ch] max-w-[80vw] bg-transparent text-center text-[26px] font-semibold outline-none placeholder:text-white/50 [text-shadow:0_1px_4px_rgba(0,0,0,0.6)]"
                style={{ color: t.color }}
              />
            ) : (
              <span
                onClick={() => setEditingId(t.id)}
                className="whitespace-pre text-[26px] font-semibold [text-shadow:0_1px_4px_rgba(0,0,0,0.6)]"
                style={{ color: t.color }}
              >
                {t.text || " "}
              </span>
            )}
          </div>
        ))}

        {/* Sticker layers. */}
        {stickers.map((s) => (
          <div
            key={s.id}
            onPointerDown={(e) => startDrag(e, s, "sticker")}
            className="absolute -translate-x-1/2 -translate-y-1/2 cursor-move text-[52px] leading-none"
            style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%` }}
          >
            {s.emoji}
          </div>
        ))}

        {/* Crop overlay — a bright rectangle over a dimmed photo, with corner
            handles; the mask is four panels around the chosen rect. */}
        {tool === "crop" && (
          <div className="absolute inset-0">
            {[
              { top: 0, left: 0, width: "100%", height: `${cropRect.y * 100}%` },
              { top: `${(cropRect.y + cropRect.h) * 100}%`, left: 0, width: "100%", bottom: 0 },
              { top: `${cropRect.y * 100}%`, left: 0, width: `${cropRect.x * 100}%`, height: `${cropRect.h * 100}%` },
              { top: `${cropRect.y * 100}%`, left: `${(cropRect.x + cropRect.w) * 100}%`, right: 0, height: `${cropRect.h * 100}%` },
            ].map((style, i) => (
              <div key={i} className="absolute bg-black/55" style={style as React.CSSProperties} />
            ))}
            <div
              onPointerDown={(e) => startCrop(e, "move")}
              className="absolute cursor-move border border-white/90"
              style={{ left: `${cropRect.x * 100}%`, top: `${cropRect.y * 100}%`, width: `${cropRect.w * 100}%`, height: `${cropRect.h * 100}%` }}
            >
              {(["nw", "ne", "sw", "se"] as const).map((corner) => (
                <span
                  key={corner}
                  onPointerDown={(e) => startCrop(e, corner)}
                  className={cn(
                    "absolute h-6 w-6 rounded-full border-2 border-white bg-black/40",
                    corner === "nw" && "-left-3 -top-3 cursor-nwse-resize",
                    corner === "ne" && "-right-3 -top-3 cursor-nesw-resize",
                    corner === "sw" && "-bottom-3 -left-3 cursor-nesw-resize",
                    corner === "se" && "-bottom-3 -right-3 cursor-nwse-resize"
                  )}
                />
              ))}
            </div>
          </div>
        )}
        </div>
        )}
      </div>

      {/* ── Toolbar ── crop, sticker, text, draw, undo (the reference's set). */}
      <div className="absolute right-3 top-3 flex items-center gap-2">
        {/* Crop bakes onto a still canvas; a clip would need a cropped re-encode,
            so it is a photo-only tool for now. */}
        {kind !== "video" && (
          <ToolButton active={tool === "crop"} label="Crop" onClick={() => setTool((t) => (t === "crop" ? "none" : "crop"))}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 2v14a2 2 0 0 0 2 2h14" />
              <path d="M2 6h14a2 2 0 0 1 2 2v14" />
            </svg>
          </ToolButton>
        )}
        <ToolButton active={tool === "sticker"} label="Stickers" onClick={() => setTool((t) => (t === "sticker" ? "none" : "sticker"))}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
            <path d="M9 9.5h.01M15 9.5h.01" />
          </svg>
        </ToolButton>
        <ToolButton active={tool === "text"} label="Add text" onClick={addText}>
          <span className="text-[15px] font-bold leading-none">T</span>
        </ToolButton>
        <ToolButton active={tool === "draw"} label="Draw" onClick={() => setTool((t) => (t === "draw" ? "none" : "draw"))}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </ToolButton>
        {(strokes.length > 0 || texts.length > 0 || stickers.length > 0) && (
          <ToolButton active={false} label="Undo" onClick={undo}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 14 4 9l5-5" />
              <path d="M4 9h11a5 5 0 0 1 0 10h-1" />
            </svg>
          </ToolButton>
        )}
      </div>

      {/* Colour swatches for draw / text — at the BOTTOM, clear of the
          top-right toolbar it used to overlap. */}
      {swatchesShown && (
        <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/50 px-2.5 py-1.5 backdrop-blur-sm">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              onClick={() => {
                setColor(c);
                if (editingId) setTexts((l) => l.map((x) => (x.id === editingId ? { ...x, color: c } : x)));
              }}
              className={cn("h-5 w-5 rounded-full border transition-transform", color === c ? "scale-110 border-white" : "border-white/40")}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      )}

      {/* Emoji picker for stickers. */}
      {tool === "sticker" && (
        <div className="absolute inset-x-3 bottom-3 flex gap-1.5 overflow-x-auto rounded-2xl bg-black/60 p-2 backdrop-blur-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {STICKERS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => addSticker(emoji)}
              className="ws-press shrink-0 rounded-lg px-1 text-2xl hover:bg-white/10"
              aria-label={`Add ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* Crop apply / cancel. */}
      {tool === "crop" && (
        <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => {
              setTool("none");
              setCropRect({ x: 0.08, y: 0.08, w: 0.84, h: 0.84 });
            }}
            className="ws-press rounded-full bg-black/60 px-4 py-2 text-[13px] font-semibold text-white backdrop-blur-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void applyCrop()}
            className="ws-press rounded-full bg-white px-5 py-2 text-[13px] font-semibold text-black"
          >
            Crop
          </button>
        </div>
      )}
    </div>
  );
});

function ToolButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        // ws-iconbtn-md: the shared icon-button scale (44px touch, 36 desktop) —
        // never a hand-written h-*/w-* (lib/button-sizing.test.ts ratchets those).
        "ws-press ws-iconbtn-md grid place-items-center rounded-full text-white backdrop-blur-sm transition-colors",
        active ? "bg-white text-black" : "bg-black/50 hover:bg-black/70"
      )}
    >
      {children}
    </button>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
}
