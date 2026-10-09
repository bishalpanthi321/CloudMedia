"use client";

import { ChangeEvent, DragEvent, FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { createJob, deleteAllJobs, fetchJob, fetchJobs, toPublicMediaUrl } from "@/lib/api";
import { Job } from "@/lib/types";
import { useVideoPlayback } from "@/hooks/use-video-playback";

type UploadState = {
  file: File | null;
  scale: number;
  text: string;
  includeCurrentTime: boolean;
  timestampFormat: "time" | "date_time";
};

type MediaDimensions = {
  width: number;
  height: number;
};

type TextOverlay = {
  id: string;
  text: string;
  // Stored in original media pixel coordinates.
  x: number;
  y: number;
  // Stored as original media pixel font size.
  fontSize: number;
  color: string;
};

const POLL_INTERVAL_MS = 2500;
const SCALE_STEPS = [0.25, 0.5, 0.75, 1] as const;

function badgeClass(status: Job["status"]) {
  if (status === "completed") {
    return "bg-emerald-100 text-emerald-700 border-emerald-200";
  }

  if (status === "processing") {
    return "bg-sky-100 text-sky-700 border-sky-200";
  }

  if (status === "failed") {
    return "bg-rose-100 text-rose-700 border-rose-200";
  }

  return "bg-amber-100 text-amber-700 border-amber-200";
}

function EditPanelHeading({ title }: { title: string }) {
  return (
    <div className="grid gap-1">
      <h3 className="font-mono text-xs uppercase tracking-[0.16em] text-amber-800">{title}</h3>
    </div>
  );
}

function EditPanelSection({ children }: { children: ReactNode }) {
  return <section className="grid gap-3 border-b-2 border-amber-300 pb-4 last:border-b-0 last:pb-0">{children}</section>;
}

export function MediaDashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [uploadState, setUploadState] = useState<UploadState>({
    file: null,
    scale: 1,
    text: "text",
    includeCurrentTime: false,
    timestampFormat: "date_time",
  });
  const [originalDimensions, setOriginalDimensions] = useState<MediaDimensions | null>(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);
  const [mediaPreviewType, setMediaPreviewType] = useState<"image" | "video" | null>(null);
  const [downsampledImagePreviewUrl, setDownsampledImagePreviewUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isDeletingHistory, setIsDeletingHistory] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [fileInputResetKey, setFileInputResetKey] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [textOverlays, setTextOverlays] = useState<TextOverlay[]>([]);
  const [previewStageSize, setPreviewStageSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [editingOverlayId, setEditingOverlayId] = useState<string | null>(null);
  const [settingsOverlayId, setSettingsOverlayId] = useState<string | null>(null);
  const mediaPreviewUrlRef = useRef<string | null>(null);
  const downsampledImagePreviewUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewStageRef = useRef<HTMLDivElement | null>(null);
  const overlayElementRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const overlayBoundsRef = useRef<Record<string, { width: number; height: number }>>({});
  const interactionRef = useRef<{
    type: "move" | "resize";
    overlayId: string;
    pointerStartX: number;
    pointerStartY: number;
    startX: number;
    startY: number;
    startFontSize: number;
  } | null>(null);
  const {
    videoRef,
    durationSeconds,
    currentSeconds,
    isPlaying,
    togglePlayback,
    seek,
    onLoadedMetadata,
    onTimeUpdate,
    onPlay,
    onPause,
    onEnded,
    reset,
  } = useVideoPlayback();

  const requestedWidth = originalDimensions ? Math.max(1, Math.round(originalDimensions.width * uploadState.scale)) : null;
  const requestedHeight = originalDimensions ? Math.max(1, Math.round(originalDimensions.height * uploadState.scale)) : null;

  function syncPreviewStageSize() {
    const rect = previewStageRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    setPreviewStageSize({ width: rect.width, height: rect.height });
  }

  const pendingJobIds = useMemo(
    () => jobs.filter((job) => job.status === "queued" || job.status === "processing").map((job) => job.id),
    [jobs]
  );

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const data = await fetchJobs();
        if (!cancelled) {
          setJobs(data);
        }
      } catch {
        if (!cancelled) {
          setErrorMessage("Unable to load edits right now.");
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (mediaPreviewUrlRef.current) {
        URL.revokeObjectURL(mediaPreviewUrlRef.current);
      }

      if (downsampledImagePreviewUrlRef.current) {
        URL.revokeObjectURL(downsampledImagePreviewUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const clearDownsamplePreview = () => {
      if (downsampledImagePreviewUrlRef.current) {
        URL.revokeObjectURL(downsampledImagePreviewUrlRef.current);
        downsampledImagePreviewUrlRef.current = null;
      }

      setDownsampledImagePreviewUrl(null);
    };

    const run = async () => {
      if (!uploadState.file || mediaPreviewType !== "image" || uploadState.scale >= 1) {
        clearDownsamplePreview();
        return;
      }

      const nextUrl = await createDownsampledImagePreviewUrl(uploadState.file, uploadState.scale);
      if (cancelled) {
        if (nextUrl) {
          URL.revokeObjectURL(nextUrl);
        }
        return;
      }

      if (downsampledImagePreviewUrlRef.current) {
        URL.revokeObjectURL(downsampledImagePreviewUrlRef.current);
      }

      downsampledImagePreviewUrlRef.current = nextUrl;
      setDownsampledImagePreviewUrl(nextUrl);
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [uploadState.file, uploadState.scale, mediaPreviewType]);

  useEffect(() => {
    if (pendingJobIds.length === 0) {
      return;
    }

    const timer = setInterval(async () => {
      const updated = await Promise.all(
        pendingJobIds.map(async (jobId) => {
          try {
            return await fetchJob(jobId);
          } catch {
            return null;
          }
        })
      );

      const byId = new Map(updated.filter(Boolean).map((job) => [job!.id, job!]));
      setJobs((current) => current.map((job) => byId.get(job.id) ?? job));
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [pendingJobIds]);

  useEffect(() => {
    syncPreviewStageSize();
    const rafId = requestAnimationFrame(syncPreviewStageSize);
    window.addEventListener("resize", syncPreviewStageSize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", syncPreviewStageSize);
    };
  }, [mediaPreviewUrl, mediaPreviewType, downsampledImagePreviewUrl]);

  useEffect(() => {
    const nextBounds: Record<string, { width: number; height: number }> = {};
    for (const overlay of textOverlays) {
      const element = overlayElementRefs.current[overlay.id];
      if (!element) {
        continue;
      }

      const rect = element.getBoundingClientRect();
      nextBounds[overlay.id] = {
        width: rect.width,
        height: rect.height,
      };
    }

    overlayBoundsRef.current = nextBounds;
  }, [textOverlays, previewStageSize]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const active = interactionRef.current;
      const stage = previewStageRef.current;
      if (!active || !stage || !originalDimensions) {
        return;
      }

      const rect = stage.getBoundingClientRect();
      const dxPx = event.clientX - active.pointerStartX;
      const dyPx = event.clientY - active.pointerStartY;
      const startDisplayX = (active.startX / Math.max(originalDimensions.width, 1)) * Math.max(rect.width, 1);
      const startDisplayY = (active.startY / Math.max(originalDimensions.height, 1)) * Math.max(rect.height, 1);

      setTextOverlays((current) =>
        current.map((overlay) => {
          if (overlay.id !== active.overlayId) {
            return overlay;
          }

          if (active.type === "move") {
            const fontSizeDisplay = (overlay.fontSize / Math.max(originalDimensions.height, 1)) * Math.max(rect.height, 1);
            const estimated = estimateOverlaySizePx(overlay.text, fontSizeDisplay);
            const measured = overlayBoundsRef.current[overlay.id];
            const overlayWidth = measured?.width ?? estimated.width;
            const overlayHeight = measured?.height ?? estimated.height;
            const nextXDisplay = clamp(startDisplayX + dxPx, 0, Math.max(rect.width - overlayWidth, 0));
            const nextYDisplay = clamp(startDisplayY + dyPx, 0, Math.max(rect.height - overlayHeight, 0));
            const nextX = (nextXDisplay / Math.max(rect.width, 1)) * originalDimensions.width;
            const nextY = (nextYDisplay / Math.max(rect.height, 1)) * originalDimensions.height;
            return { ...overlay, x: nextX, y: nextY };
          }

          const startFontDisplay = (active.startFontSize / Math.max(originalDimensions.height, 1)) * Math.max(rect.height, 1);
          const sizeDelta = (dxPx + dyPx) / 8;
          const nextFontDisplay = clamp(startFontDisplay + sizeDelta, 12, 200);
          const nextFontSize = (nextFontDisplay / Math.max(rect.height, 1)) * originalDimensions.height;
          const nextSize = estimateOverlaySizePx(overlay.text, nextFontDisplay);
          const nextXDisplay = clamp(
            (overlay.x / Math.max(originalDimensions.width, 1)) * Math.max(rect.width, 1),
            0,
            Math.max(rect.width - nextSize.width, 0)
          );
          const nextYDisplay = clamp(
            (overlay.y / Math.max(originalDimensions.height, 1)) * Math.max(rect.height, 1),
            0,
            Math.max(rect.height - nextSize.height, 0)
          );
          return {
            ...overlay,
            x: (nextXDisplay / Math.max(rect.width, 1)) * originalDimensions.width,
            y: (nextYDisplay / Math.max(rect.height, 1)) * originalDimensions.height,
            fontSize: Math.round(nextFontSize),
          };
        })
      );
    };

    const handlePointerUp = () => {
      interactionRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [originalDimensions]);

  useEffect(() => {
    const handleWindowDragOver = (event: globalThis.DragEvent) => {
      if (!hasMediaPayload(event.dataTransfer)) {
        return;
      }

      event.preventDefault();
      event.dataTransfer!.dropEffect = "copy";
    };

    const handleWindowDrop = async (event: globalThis.DragEvent) => {
      if (!hasMediaPayload(event.dataTransfer)) {
        return;
      }

      event.preventDefault();
      await loadSelectedFile(event.dataTransfer?.files?.[0] ?? null);
    };

    window.addEventListener("dragover", handleWindowDragOver);
    window.addEventListener("drop", handleWindowDrop);

    return () => {
      window.removeEventListener("dragover", handleWindowDragOver);
      window.removeEventListener("drop", handleWindowDrop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleDocumentPointerDown = (event: PointerEvent) => {
      const stage = previewStageRef.current;
      const target = event.target as Node | null;
      if (!target || !stage) {
        return;
      }

      if (stage.contains(target)) {
        return;
      }

      setSelectedOverlayId(null);
      setEditingOverlayId(null);
      setSettingsOverlayId(null);
    };

    document.addEventListener("pointerdown", handleDocumentPointerDown, true);

    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!uploadState.file) {
      setErrorMessage("Choose an image or video file first.");
      return;
    }

    setIsSubmitting(true);
    setUploadProgress(0);
    setErrorMessage(null);

    try {
      // Preview overlay uses padded/bordered boxes; backend renders text only.
      // Shift submitted coordinates by the text inset so output matches preview glyph position.
      const overlayTextInsetX =
        originalDimensions && previewStageSize.width > 0 ? (7 / previewStageSize.width) * originalDimensions.width : 0;
      const overlayTextInsetY =
        originalDimensions && previewStageSize.height > 0 ? (3 / previewStageSize.height) * originalDimensions.height : 0;

      const createdJob = await createJob({
        file: uploadState.file,
        requestedWidth: requestedWidth ?? undefined,
        watermarkText: uploadState.text || undefined,
        textOverlays: textOverlays.map((overlay) => ({
          text: overlay.text,
          x: overlay.x + overlayTextInsetX,
          y: overlay.y + overlayTextInsetY,
          fontSize: overlay.fontSize,
          color: overlay.color,
        })),
        includeCurrentTime: uploadState.includeCurrentTime,
        timestampFormat: uploadState.timestampFormat,
        onUploadProgress: (percent) => setUploadProgress(percent),
      });

      setJobs((current) => [createdJob, ...current.filter((job) => job.id !== createdJob.id)]);

      setUploadState((current) => ({ ...current, file: null, scale: 1 }));
      setOriginalDimensions(null);
      setMediaPreviewUrl(null);
      setMediaPreviewType(null);
      setDownsampledImagePreviewUrl(null);
      setTextOverlays([]);
      setSelectedOverlayId(null);
      setEditingOverlayId(null);
      setSettingsOverlayId(null);
      reset();
      setFileInputResetKey((current) => current + 1);
    } catch {
      setErrorMessage("Failed to create edit. Check API logs and try again.");
    } finally {
      setIsSubmitting(false);
      setUploadProgress(null);
    }
  }

  async function loadSelectedFile(selected: File | null) {
    if (selected && !isSupportedMediaFile(selected)) {
      setUploadState((current) => ({ ...current, file: null, scale: 1 }));
      setOriginalDimensions(null);
      setMediaPreviewUrl(null);
      setMediaPreviewType(null);
      setDownsampledImagePreviewUrl(null);
      setTextOverlays([]);
      setSelectedOverlayId(null);
      setEditingOverlayId(null);
      setSettingsOverlayId(null);
      reset();
      setErrorMessage("Only image and video files are allowed.");
      setFileInputResetKey((current) => current + 1);
      return;
    }

    setUploadState((current) => ({ ...current, file: selected, scale: 1 }));
    setErrorMessage(null);

    if (mediaPreviewUrlRef.current) {
      URL.revokeObjectURL(mediaPreviewUrlRef.current);
      mediaPreviewUrlRef.current = null;
    }

    if (selected) {
      const objectUrl = URL.createObjectURL(selected);
      mediaPreviewUrlRef.current = objectUrl;
      setMediaPreviewUrl(objectUrl);
      setMediaPreviewType(selected.type.startsWith("video/") ? "video" : "image");
    } else {
      setMediaPreviewUrl(null);
      setMediaPreviewType(null);
      setDownsampledImagePreviewUrl(null);
      setTextOverlays([]);
      setSelectedOverlayId(null);
      setEditingOverlayId(null);
      setSettingsOverlayId(null);
    }

    if (!selected) {
      setOriginalDimensions(null);
      reset();
      return;
    }

    const dimensions = await detectMediaDimensions(selected);
    setOriginalDimensions(dimensions);

    if (!selected.type.startsWith("video/")) {
      reset();
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    await loadSelectedFile(event.target.files?.[0] || null);
  }

  async function handleInputDrop(event: DragEvent<HTMLDivElement>) {
    if (!hasMediaPayload(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    await loadSelectedFile(event.dataTransfer.files?.[0] || null);
  }

  function handleScaleChange(event: ChangeEvent<HTMLInputElement>) {
    const nextScale = Number(event.target.value);
    setUploadState((current) => ({ ...current, scale: nextScale }));
  }

  async function handleDeleteAllEdits() {
    setIsDeletingHistory(true);
    setErrorMessage(null);

    try {
      await deleteAllJobs();
      setJobs([]);
      setIsDeleteDialogOpen(false);
    } catch {
      setErrorMessage("Failed to delete edit history. Try again.");
    } finally {
      setIsDeletingHistory(false);
    }
  }

  function addOverlayAtPoint(clientX: number, clientY: number, textValue: string) {
    const stage = previewStageRef.current;
    if (!stage || !originalDimensions) {
      return;
    }

    const rect = stage.getBoundingClientRect();
    const cleanText = textValue.trim();
    if (!cleanText) {
      return;
    }

    const fontSizeDisplay = 24;
    const fontSizeOriginal = (fontSizeDisplay / Math.max(rect.height, 1)) * originalDimensions.height;
    const overlaySize = estimateOverlaySizePx(cleanText, fontSizeDisplay);
    const relativeXPx = clientX - rect.left;
    const relativeYPx = clientY - rect.top;
    const nextXDisplay = clamp(relativeXPx - overlaySize.width / 2, 0, Math.max(rect.width - overlaySize.width, 0));
    const nextYDisplay = clamp(relativeYPx - overlaySize.height / 2, 0, Math.max(rect.height - overlaySize.height, 0));

    const nextOverlay: TextOverlay = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      text: "text",
      x: (nextXDisplay / Math.max(rect.width, 1)) * originalDimensions.width,
      y: (nextYDisplay / Math.max(rect.height, 1)) * originalDimensions.height,
      fontSize: fontSizeOriginal,
      color: "#ffffff",
    };

    setTextOverlays((current) => [...current, nextOverlay]);
    setSelectedOverlayId(nextOverlay.id);
    setEditingOverlayId(nextOverlay.id);
  }

  function handleOverlayDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const droppedText = event.dataTransfer.getData("text/plain") || "text";
    addOverlayAtPoint(event.clientX, event.clientY, droppedText);
  }

  function beginMoveOverlay(event: React.PointerEvent<HTMLDivElement>, overlayId: string) {
    if (
      (event.target as HTMLElement).closest("[data-resize-handle='true']") ||
      (event.target as HTMLElement).closest("[data-delete-handle='true']") ||
      (event.target as HTMLElement).closest("[data-settings-handle='true']") ||
      (event.target as HTMLElement).closest("[data-settings-panel='true']")
    ) {
      return;
    }

    const overlay = textOverlays.find((item) => item.id === overlayId);
    if (!overlay) {
      return;
    }

    event.preventDefault();
    setSelectedOverlayId(overlayId);
    setEditingOverlayId(null);
    setSettingsOverlayId(null);
    interactionRef.current = {
      type: "move",
      overlayId,
      pointerStartX: event.clientX,
      pointerStartY: event.clientY,
      startX: overlay.x,
      startY: overlay.y,
      startFontSize: overlay.fontSize,
    };
  }

  function beginResizeOverlay(event: React.PointerEvent<HTMLButtonElement>, overlayId: string) {
    event.preventDefault();
    event.stopPropagation();
    const overlay = textOverlays.find((item) => item.id === overlayId);
    if (!overlay) {
      return;
    }

    setSelectedOverlayId(overlayId);
    setEditingOverlayId(null);
    setSettingsOverlayId(null);
    interactionRef.current = {
      type: "resize",
      overlayId,
      pointerStartX: event.clientX,
      pointerStartY: event.clientY,
      startX: overlay.x,
      startY: overlay.y,
      startFontSize: overlay.fontSize,
    };
  }

  function updateSelectedOverlayText(nextText: string) {
    if (!selectedOverlayId) {
      return;
    }

    setTextOverlays((current) =>
      current.map((overlay) => {
        if (overlay.id !== selectedOverlayId) {
          return overlay;
        }

        if (!originalDimensions || previewStageSize.width <= 0 || previewStageSize.height <= 0) {
          return { ...overlay, text: nextText };
        }

        const fontSizeDisplay = (overlay.fontSize / Math.max(originalDimensions.height, 1)) * previewStageSize.height;
        const overlaySize = estimateOverlaySizePx(nextText, fontSizeDisplay);
        const xDisplay = clamp(
          (overlay.x / Math.max(originalDimensions.width, 1)) * previewStageSize.width,
          0,
          Math.max(previewStageSize.width - overlaySize.width, 0)
        );
        const yDisplay = clamp(
          (overlay.y / Math.max(originalDimensions.height, 1)) * previewStageSize.height,
          0,
          Math.max(previewStageSize.height - overlaySize.height, 0)
        );

        return {
          ...overlay,
          text: nextText,
          x: (xDisplay / Math.max(previewStageSize.width, 1)) * originalDimensions.width,
          y: (yDisplay / Math.max(previewStageSize.height, 1)) * originalDimensions.height,
        };
      })
    );
  }

  function updateOverlayColor(overlayId: string, color: string) {
    setTextOverlays((current) => current.map((overlay) => (overlay.id === overlayId ? { ...overlay, color } : overlay)));
  }

  const dragTextValue = "text";

  function removeOverlayById(overlayId: string) {
    setTextOverlays((current) => current.filter((overlay) => overlay.id !== overlayId));
    if (selectedOverlayId === overlayId) {
      setSelectedOverlayId(null);
      setEditingOverlayId(null);
    }
    if (settingsOverlayId === overlayId) {
      setSettingsOverlayId(null);
    }
  }

  async function handleDownloadOutput(outputUrl: string, originalFilename: string, mediaType: Job["media_type"]) {
    try {
      const response = await fetch(outputUrl);
      if (!response.ok) {
        throw new Error(`Failed to download output: ${response.status}`);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const extension = mediaType === "image" ? "jpg" : "mp4";
      const baseName = originalFilename.replace(/\.[^/.]+$/, "").trim() || "output";
      anchor.href = objectUrl;
      anchor.download = `${baseName}_edited.${extension}`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setErrorMessage("Failed to download output. Try again.");
    }
  }

  function getOverlayDisplayStyle(overlay: TextOverlay) {
    if (!originalDimensions || previewStageSize.width <= 0 || previewStageSize.height <= 0) {
      return {
        left: "0px",
        top: "0px",
        fontSize: "16px",
      };
    }

    const left = (overlay.x / Math.max(originalDimensions.width, 1)) * previewStageSize.width;
    const top = (overlay.y / Math.max(originalDimensions.height, 1)) * previewStageSize.height;
    const fontSize = (overlay.fontSize / Math.max(originalDimensions.height, 1)) * previewStageSize.height;

    return {
      left: `${left}px`,
      top: `${top}px`,
      fontSize: `${fontSize}px`,
    };
  }

  return (
    <>
      <main className="mx-auto my-8 grid w-[min(1120px,calc(100%-1rem))] gap-4 px-2 md:my-10 md:w-[min(1120px,calc(100%-2rem))]">
      <section className="animate-[rise-in_500ms_ease-out_both] rounded-3xl border border-white/80 bg-amber-50 px-5 py-5 shadow-[0_16px_40px_rgba(0,0,0,0.1)] md:px-7 md:py-6">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-amber-800">Media Editing</p>
        <h1 className="mt-1 text-3xl font-semibold leading-[1.05] tracking-tight text-zinc-900 md:text-5xl">
          Resize media and add text.
        </h1>
      </section>

      <section className="grid grid-cols-12 gap-4">
        <article className="animate-[rise-in_560ms_ease-out_both] col-span-12 min-w-0 rounded-3xl border border-amber-100 bg-[#f6f2e9] p-5 shadow-[0_10px_22px_rgba(0,0,0,0.08)] md:col-span-5 md:p-6">
          <h2 className="mb-4 text-4xl font-semibold text-zinc-900">New Edit</h2>
          <form onSubmit={handleSubmit} className="grid gap-4">
            <EditPanelSection>
              <EditPanelHeading title="Media" />
              <div
                onDragOver={(event) => {
                  if (!hasMediaPayload(event.dataTransfer)) {
                    return;
                  }

                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                }}
                onDrop={handleInputDrop}
                className="grid gap-2"
              >
                <label className="grid gap-1 text-sm text-zinc-700">
                  Media File
                  <div className="flex min-w-0 items-center gap-2 rounded-xl border border-amber-200 bg-white p-2 text-zinc-700">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="shrink-0 rounded-lg border border-amber-200 bg-[#f8f6f1] px-3 py-1.5 text-sm text-zinc-700 transition hover:border-orange-300"
                    >
                      Choose File
                    </button>
                    <div className="min-w-0 flex-1 px-1 text-sm text-zinc-600">
                      <span className="block truncate">{uploadState.file?.name ?? "No file chosen"}</span>
                    </div>
                    <input
                      ref={fileInputRef}
                      key={fileInputResetKey}
                      type="file"
                      accept="image/*,video/*"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </div>
                </label>
                <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-zinc-500">Image and video files only</p>
              </div>

              <div className="grid gap-2 text-sm text-zinc-700">
                <p>Original resolution</p>
                <div className="rounded-xl border border-amber-200 bg-white px-3.5 py-2.5 font-mono text-sm text-zinc-700">
                  {originalDimensions ? `${originalDimensions.width} x ${originalDimensions.height}` : "Select a file"}
                </div>
              </div>
            </EditPanelSection>

            <EditPanelSection>
              <EditPanelHeading title="Resize" />
              <div className="grid gap-2 text-sm text-zinc-700">
                <label htmlFor="scale-slider">Scale</label>
                <input
                  id="scale-slider"
                  type="range"
                  min={0.25}
                  max={1}
                  step={0.25}
                  value={uploadState.scale}
                  onChange={handleScaleChange}
                  disabled={!originalDimensions}
                  className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-amber-100 accent-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <div className="grid grid-cols-4 text-center font-mono text-xs text-zinc-500">
                  {SCALE_STEPS.map((step) => (
                    <span key={step}>{step}</span>
                  ))}
                </div>
                <div className="rounded-xl border border-amber-200 bg-white px-3.5 py-2.5 font-mono text-xs text-zinc-700">
                  Target resolution: {requestedWidth && requestedHeight ? `${requestedWidth} x ${requestedHeight}` : "n/a"}
                </div>
              </div>
            </EditPanelSection>

            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-1 w-full rounded-full bg-linear-to-r from-orange-400 to-orange-500 px-4 py-3 text-xl font-semibold text-white shadow-[0_8px_18px_rgba(234,131,65,0.35)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {!isSubmitting
                ? "Apply Edit"
                : uploadProgress !== null && uploadProgress < 100
                  ? `Uploading... ${uploadProgress}%`
                  : "Queueing..."}
            </button>

            {isSubmitting && uploadProgress !== null && uploadProgress < 100 ? (
              <div className="grid gap-1">
                <div className="h-2 overflow-hidden rounded-full bg-amber-100">
                  <div
                    className="h-full bg-linear-to-r from-orange-400 to-orange-500 transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <p className="text-xs text-zinc-600">Uploading media...</p>
              </div>
            ) : null}
          </form>

          {errorMessage ? <p className="mt-3 font-mono text-xs text-rose-700">{errorMessage}</p> : null}
        </article>

        <article className="animate-[rise-in_620ms_ease-out_both] col-span-12 min-w-0 rounded-3xl border border-amber-100 bg-[#f6f2e9] p-5 shadow-[0_10px_22px_rgba(0,0,0,0.08)] md:col-span-7 md:p-6">
          <h2 className="mb-4 text-4xl font-semibold text-zinc-900">Media Preview</h2>
          {!mediaPreviewUrl ? (
            <div className="grid min-h-90 place-items-center rounded-2xl border border-dashed border-amber-300 bg-white/60 p-6 text-center text-sm text-zinc-500">
              Choose or drop an image/video to preview it here.
            </div>
          ) : null}

          {mediaPreviewUrl && mediaPreviewType === "image" ? (
            <div className="grid place-items-center overflow-hidden rounded-2xl border border-amber-200 bg-zinc-200/60 p-2">
              <div
                ref={previewStageRef}
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleOverlayDrop}
                onPointerDown={(event) => {
                  if (event.target === event.currentTarget) {
                    setSelectedOverlayId(null);
                    setEditingOverlayId(null);
                    setSettingsOverlayId(null);
                  }
                }}
                className="relative inline-block max-w-full"
              >
                <img
                  src={downsampledImagePreviewUrl ?? mediaPreviewUrl}
                  alt="Selected media preview"
                  draggable={false}
                  onLoad={syncPreviewStageSize}
                  className="max-h-140 block max-w-full object-contain"
                />
                {textOverlays.map((overlay) => (
                  <div
                    key={overlay.id}
                    ref={(element) => {
                      overlayElementRefs.current[overlay.id] = element;
                    }}
                    onPointerDown={(event) => beginMoveOverlay(event, overlay.id)}
                    onDoubleClick={() => {
                      setSelectedOverlayId(overlay.id);
                      setEditingOverlayId(overlay.id);
                    }}
                    className={`absolute cursor-move select-none rounded-md border px-1.5 py-0.5 text-white shadow-[0_8px_20px_rgba(0,0,0,0.45)] ${
                      selectedOverlayId === overlay.id ? "border-orange-300 bg-transparent" : "border-white/40 bg-transparent"
                    }`}
                    style={{ ...getOverlayDisplayStyle(overlay), color: overlay.color }}
                  >
                    {editingOverlayId === overlay.id ? (
                      <input
                        autoFocus
                        value={overlay.text}
                        onChange={(event) => updateSelectedOverlayText(event.target.value)}
                        onBlur={() => setEditingOverlayId(null)}
                        style={{ width: `${Math.max((overlay.text || "text").length + 1, 4)}ch` }}
                        className="rounded bg-white/90 px-1.5 text-black outline-none"
                      />
                    ) : (
                      <span className="block whitespace-nowrap">{overlay.text || " "}</span>
                    )}
                    {selectedOverlayId === overlay.id ? (
                      <>
                        {settingsOverlayId === overlay.id ? (
                          <div
                            data-settings-panel="true"
                            onPointerDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                            className="absolute -top-14 right-0 z-20 inline-flex items-center gap-2 rounded-xl border border-orange-300 bg-black/55 p-2 text-white shadow-[0_10px_24px_rgba(0,0,0,0.22)]"
                          >
                            <div className="relative inline-flex items-center gap-2 rounded-lg border border-white/40 bg-black/35 px-2 py-1.5">
                              <span className="h-5 w-5 rounded-full border border-white/60" style={{ backgroundColor: overlay.color }} />
                              <input
                                type="color"
                                value={overlay.color}
                                onChange={(event) => updateOverlayColor(overlay.id, event.target.value)}
                                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                                aria-label="Change text color"
                              />
                            </div>
                            <button
                              type="button"
                              data-delete-handle="true"
                              onPointerDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                removeOverlayById(overlay.id);
                              }}
                              aria-label="Delete text"
                              title="Delete text"
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-rose-300/70 bg-rose-500/15 text-rose-200 transition hover:border-rose-200 hover:bg-rose-500/25"
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-current">
                                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm3.46-7.12 1.41-1.41L12 11.59l1.12-1.12 1.41 1.41L13.41 13l1.12 1.12-1.41 1.41L12 14.41l-1.12 1.12-1.41-1.41L10.59 13l-1.13-1.12zM15.5 4l-1-1h-5l-1 1H5v2h14V4z" />
                              </svg>
                            </button>
                          </div>
                        ) : null}
                        <button
                          type="button"
                          data-settings-handle="true"
                          onPointerDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setSettingsOverlayId((current) => (current === overlay.id ? null : overlay.id));
                          }}
                          aria-label="Open text settings"
                          title="Open text settings"
                          className="absolute -top-2 -right-2 grid h-5 w-5 place-items-center rounded-full border border-zinc-300 bg-zinc-200 text-zinc-700"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3 w-3 fill-current">
                            <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 00.12-.64l-1.92-3.32a.5.5 0 00-.6-.22l-2.39.96a7.03 7.03 0 00-1.63-.94l-.36-2.54A.5.5 0 0013.9 2h-3.8a.5.5 0 00-.49.42l-.36 2.54c-.58.22-1.12.53-1.63.94l-2.39-.96a.5.5 0 00-.6.22L2.71 8.48a.5.5 0 00.12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 00-.12.64l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.5.41 1.05.72 1.63.94l.36 2.54c.05.24.25.42.49.42h3.8c.24 0 .44-.18.49-.42l.36-2.54c.58-.22 1.12-.53 1.63-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 00-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1112 8a3.5 3.5 0 010 7.5z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          data-resize-handle="true"
                          onPointerDown={(event) => beginResizeOverlay(event, overlay.id)}
                          aria-label="Resize text"
                          title="Resize text"
                          className="absolute -bottom-2 -right-2 h-4 w-4 rounded-full border border-orange-300 bg-orange-400"
                        />
                      </>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {mediaPreviewUrl && mediaPreviewType === "video" ? (
            <>
              <div className="grid place-items-center overflow-hidden rounded-2xl border border-amber-200 bg-black/90 p-2">
                <div
                  ref={previewStageRef}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={handleOverlayDrop}
                  onPointerDown={(event) => {
                    if (event.target === event.currentTarget) {
                      setSelectedOverlayId(null);
                      setEditingOverlayId(null);
                      setSettingsOverlayId(null);
                    }
                  }}
                  className="relative inline-block max-w-full"
                >
                  <video
                    ref={videoRef}
                    src={mediaPreviewUrl}
                    draggable={false}
                    preload="metadata"
                    className="max-h-140 block max-w-full rounded-xl bg-black"
                    onLoadedMetadata={(event) => {
                      onLoadedMetadata(event);
                      syncPreviewStageSize();
                    }}
                    onTimeUpdate={onTimeUpdate}
                    onPlay={onPlay}
                    onPause={onPause}
                    onEnded={onEnded}
                  />
                  {textOverlays.map((overlay) => (
                    <div
                      key={overlay.id}
                      ref={(element) => {
                        overlayElementRefs.current[overlay.id] = element;
                      }}
                      onPointerDown={(event) => beginMoveOverlay(event, overlay.id)}
                      onDoubleClick={() => {
                        setSelectedOverlayId(overlay.id);
                        setEditingOverlayId(overlay.id);
                      }}
                      className={`absolute cursor-move select-none rounded-md border px-1.5 py-0.5 text-white shadow-[0_8px_20px_rgba(0,0,0,0.45)] ${
                        selectedOverlayId === overlay.id ? "border-orange-300 bg-transparent" : "border-white/40 bg-transparent"
                      }`}
                      style={{ ...getOverlayDisplayStyle(overlay), color: overlay.color }}
                    >
                      {editingOverlayId === overlay.id ? (
                        <input
                          autoFocus
                          value={overlay.text}
                          onChange={(event) => updateSelectedOverlayText(event.target.value)}
                          onBlur={() => setEditingOverlayId(null)}
                          style={{ width: `${Math.max((overlay.text || "text").length + 1, 4)}ch` }}
                          className="rounded bg-white/90 px-1.5 text-black outline-none"
                        />
                      ) : (
                        <span className="block whitespace-nowrap">{overlay.text || " "}</span>
                      )}
                      {selectedOverlayId === overlay.id ? (
                        <>
                          {settingsOverlayId === overlay.id ? (
                            <div
                              data-settings-panel="true"
                              onPointerDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                              }}
                              className="absolute -top-14 right-0 z-20 inline-flex items-center gap-2 rounded-xl border border-orange-300 bg-black/55 p-2 text-white shadow-[0_10px_24px_rgba(0,0,0,0.22)]"
                            >
                              <div className="relative inline-flex items-center gap-2 rounded-lg border border-white/40 bg-black/35 px-2 py-1.5">
                                <span className="h-5 w-5 rounded-full border border-white/60" style={{ backgroundColor: overlay.color }} />
                                <input
                                  type="color"
                                  value={overlay.color}
                                  onChange={(event) => updateOverlayColor(overlay.id, event.target.value)}
                                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                                  aria-label="Change text color"
                                />
                              </div>
                              <button
                                type="button"
                                data-delete-handle="true"
                                onPointerDown={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  removeOverlayById(overlay.id);
                                }}
                                aria-label="Delete text"
                                title="Delete text"
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-rose-300/70 bg-rose-500/15 text-rose-200 transition hover:border-rose-200 hover:bg-rose-500/25"
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-current">
                                  <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm3.46-7.12 1.41-1.41L12 11.59l1.12-1.12 1.41 1.41L13.41 13l1.12 1.12-1.41 1.41L12 14.41l-1.12 1.12-1.41-1.41L10.59 13l-1.13-1.12zM15.5 4l-1-1h-5l-1 1H5v2h14V4z" />
                                </svg>
                              </button>
                            </div>
                          ) : null}
                          <button
                            type="button"
                            data-settings-handle="true"
                            onPointerDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setSettingsOverlayId((current) => (current === overlay.id ? null : overlay.id));
                            }}
                            aria-label="Open text settings"
                            title="Open text settings"
                            className="absolute -top-2 -right-2 grid h-5 w-5 place-items-center rounded-full border border-zinc-300 bg-zinc-200 text-zinc-700"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3 w-3 fill-current">
                              <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 00.12-.64l-1.92-3.32a.5.5 0 00-.6-.22l-2.39.96a7.03 7.03 0 00-1.63-.94l-.36-2.54A.5.5 0 0013.9 2h-3.8a.5.5 0 00-.49.42l-.36 2.54c-.58.22-1.12.53-1.63.94l-2.39-.96a.5.5 0 00-.6.22L2.71 8.48a.5.5 0 00.12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 00-.12.64l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.5.41 1.05.72 1.63.94l.36 2.54c.05.24.25.42.49.42h3.8c.24 0 .44-.18.49-.42l.36-2.54c.58-.22 1.12-.53 1.63-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 00-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1112 8a3.5 3.5 0 010 7.5z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            data-resize-handle="true"
                            onPointerDown={(event) => beginResizeOverlay(event, overlay.id)}
                            aria-label="Resize text"
                            title="Resize text"
                            className="absolute -bottom-2 -right-2 h-4 w-4 rounded-full border border-orange-300 bg-orange-400"
                          />
                        </>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-3 grid gap-2 rounded-xl border border-amber-200 bg-[#f7f3ea] p-3">
                <div className="flex items-center gap-3 text-zinc-700">
                  <button
                    type="button"
                    onClick={togglePlayback}
                    aria-label={isPlaying ? "Pause playback" : "Start playback"}
                    title={isPlaying ? "Pause playback" : "Start playback"}
                    className="text-zinc-700 transition hover:text-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={durationSeconds <= 0}
                  >
                    {isPlaying ? (
                      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6 fill-current">
                        <path d="M8 6h3v12H8zm5 0h3v12h-3z" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6 fill-current">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    )}
                  </button>
                  <span className="ml-auto font-mono text-xs text-zinc-600">
                    {formatTime(currentSeconds)} / {formatTime(durationSeconds)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.max(durationSeconds, 0)}
                  step={0.1}
                  value={Math.min(currentSeconds, durationSeconds || 0)}
                  onChange={seek}
                  disabled={durationSeconds <= 0}
                  className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-amber-100 accent-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
            </>
          ) : null}

          {mediaPreviewUrl ? (
            <div className="mt-3">
              <div
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData("text/plain", dragTextValue);
                  event.dataTransfer.effectAllowed = "copy";
                }}
                className="inline-flex cursor-grab rounded-full border border-orange-300 bg-orange-100 px-3 py-1.5 font-mono text-xs text-zinc-700 active:cursor-grabbing"
              >
                Drag to add text
              </div>
            </div>
          ) : null}
        </article>
      </section>

      <section className="animate-[rise-in_680ms_ease-out_both]">
        <article className="min-w-0 rounded-3xl border border-amber-100 bg-[#f6f2e9] p-5 shadow-[0_10px_22px_rgba(0,0,0,0.08)] md:p-6">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="text-4xl font-semibold text-zinc-900">Recent Edits</h2>
            <button
              type="button"
              aria-label="Delete all recent edits"
              title="Delete all recent edits"
              onClick={() => setIsDeleteDialogOpen(true)}
              disabled={jobs.length === 0 || isDeletingHistory}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-amber-200 bg-white text-zinc-700 transition hover:border-rose-300 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-current">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm3.46-7.12 1.41-1.41L12 11.59l1.12-1.12 1.41 1.41L13.41 13l1.12 1.12-1.41 1.41L12 14.41l-1.12 1.12-1.41-1.41L10.59 13l-1.13-1.12zM15.5 4l-1-1h-5l-1 1H5v2h14V4z" />
              </svg>
            </button>
          </div>
          <ul className="grid gap-3">
            {jobs.length === 0 ? (
              <li className="rounded-2xl border border-dashed border-amber-300 px-4 py-4 text-center text-sm text-zinc-500">
                No edits yet.
              </li>
            ) : null}
            {jobs.map((job) => {
              const outputUrl = toPublicMediaUrl(job.output_url);

              return (
                <li
                  key={job.id}
                  className="grid grid-cols-1 gap-x-3 gap-y-1 rounded-2xl border border-amber-100 bg-white px-3 py-3 sm:grid-cols-[1fr_auto]"
                >
                  <div>
                    <p className="break-all text-sm font-semibold text-zinc-900">{job.original_filename}</p>
                    <p className="font-mono text-xs tracking-wider text-zinc-500">{job.media_type.toUpperCase()}</p>
                  </div>
                  <span
                    className={`justify-self-start self-start rounded-full border px-2 py-1 font-mono text-[11px] sm:justify-self-end sm:self-center ${badgeClass(job.status)}`}
                  >
                    {job.status}
                  </span>
                  {outputUrl && job.media_type === "image" ? (
                    <div className="flex items-center gap-3 sm:col-span-2">
                      <a
                        href={outputUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-xs text-blue-700 hover:underline"
                      >
                        view image
                      </a>
                      <button
                        type="button"
                        onClick={() => void handleDownloadOutput(outputUrl, job.original_filename, job.media_type)}
                        className="font-mono text-xs text-blue-700 hover:underline"
                      >
                        download
                      </button>
                    </div>
                  ) : null}
                  {outputUrl && job.media_type === "video" ? (
                    <div className="flex items-center gap-3 sm:col-span-2">
                      <a
                        href={outputUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-xs text-blue-700 hover:underline"
                      >
                        view output
                      </a>
                      <button
                        type="button"
                        onClick={() => void handleDownloadOutput(outputUrl, job.original_filename, job.media_type)}
                        className="font-mono text-xs text-blue-700 hover:underline"
                      >
                        download
                      </button>
                    </div>
                  ) : null}
                  {job.error_message ? (
                    <p className="text-xs text-rose-700 sm:col-span-2">{job.error_message}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </article>
      </section>

      {isDeleteDialogOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-900/45 px-4">
          <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-white p-5 shadow-[0_20px_50px_rgba(0,0,0,0.25)]">
            <h3 className="text-lg font-semibold text-zinc-900">Delete all recent edits?</h3>
            <p className="mt-2 text-sm text-zinc-600">This removes your full edit history and generated outputs.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsDeleteDialogOpen(false)}
                disabled={isDeletingHistory}
                className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteAllEdits}
                disabled={isDeletingHistory}
                className="rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isDeletingHistory ? "Deleting..." : "Delete All"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      </main>
    </>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function estimateOverlaySizePx(text: string, fontSize: number) {
  const safeText = text || " ";
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    const fallbackWidth = safeText.length * fontSize * 0.62 + 18;
    const fallbackHeight = fontSize * 1.35 + 10;
    return { width: fallbackWidth, height: fallbackHeight };
  }

  context.font = `${fontSize}px sans-serif`;
  const metrics = context.measureText(safeText);
  const textWidth = metrics.width;
  const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.8;
  const descent = metrics.actualBoundingBoxDescent || fontSize * 0.2;

  // Matches overlay styling: px-1.5, py-0.5, border.
  const width = textWidth + 12 + 2;
  const height = ascent + descent + 4 + 2;

  return { width, height };
}

function hasMediaPayload(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) {
    return false;
  }

  if (dataTransfer.items.length > 0) {
    return Array.from(dataTransfer.items).some(
      (item) => item.kind === "file" && (item.type.startsWith("image/") || item.type.startsWith("video/"))
    );
  }

  return Array.from(dataTransfer.files).some((file) => isSupportedMediaFile(file));
}

function isSupportedMediaFile(file: File) {
  return file.type.startsWith("image/") || file.type.startsWith("video/");
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "00:00";
  }

  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const secs = (total % 60).toString().padStart(2, "0");

  return `${mins}:${secs}`;
}

async function detectMediaDimensions(file: File): Promise<MediaDimensions | null> {
  if (file.type.startsWith("image/")) {
    return readImageDimensions(file);
  }

  if (file.type.startsWith("video/")) {
    return readVideoDimensions(file);
  }

  return null;
}

function readImageDimensions(file: File): Promise<MediaDimensions | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      const result = { width: image.naturalWidth, height: image.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(result);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };

    image.src = url;
  });
}

function readVideoDimensions(file: File): Promise<MediaDimensions | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";

    video.onloadedmetadata = () => {
      const result = { width: video.videoWidth, height: video.videoHeight };
      URL.revokeObjectURL(url);
      resolve(result);
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };

    video.src = url;
  });
}

async function createDownsampledImagePreviewUrl(file: File, scale: number): Promise<string | null> {
  if (!(scale > 0 && scale < 1)) {
    return null;
  }

  const sourceUrl = URL.createObjectURL(file);

  try {
    const image = await loadImage(sourceUrl);
    const sourceWidth = image.naturalWidth;
    const sourceHeight = image.naturalHeight;
    const downsampledWidth = Math.max(1, Math.round(sourceWidth * scale));
    const downsampledHeight = Math.max(1, Math.round(sourceHeight * scale));

    const downsampleCanvas = document.createElement("canvas");
    downsampleCanvas.width = downsampledWidth;
    downsampleCanvas.height = downsampledHeight;
    const downsampleContext = downsampleCanvas.getContext("2d");
    if (!downsampleContext) {
      return null;
    }

    downsampleContext.imageSmoothingEnabled = true;
    downsampleContext.drawImage(image, 0, 0, downsampledWidth, downsampledHeight);

    const previewCanvas = document.createElement("canvas");
    previewCanvas.width = sourceWidth;
    previewCanvas.height = sourceHeight;
    const previewContext = previewCanvas.getContext("2d");
    if (!previewContext) {
      return null;
    }

    previewContext.imageSmoothingEnabled = true;
    previewContext.drawImage(downsampleCanvas, 0, 0, sourceWidth, sourceHeight);

    const mimeType = file.type.startsWith("image/") ? file.type : "image/png";
    const blob = await canvasToBlob(previewCanvas, mimeType);
    return blob ? URL.createObjectURL(blob) : null;
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to decode image for preview."));

    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, 0.92);
  });
}
