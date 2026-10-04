import { useRef, useState } from "react";
import type { Attachment } from "../api.ts";
import { useI18n } from "../i18n/index.tsx";
import { useSession } from "../session.tsx";

/** Longest side of an uploaded screenshot: sharp on any screen, a few hundred KB as JPEG. */
const MAX_SIDE = 1600;
const MAX_BYTES = 5 * 1024 * 1024;
/** Screenshots per result, as the API allows. */
export const MAX_SCREENSHOTS = 5;

/**
 * Scales a photo or screenshot down and re-encodes it as JPEG in the browser, so
 * a phone on mobile data uploads hundreds of kilobytes, not a 10 MB original.
 */
async function compress(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("unreadable");
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.82, 0.65, 0.5]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= MAX_BYTES) return blob;
  }
  throw new Error("too_large");
}

/** Thumbnails of the screenshots attached to a result; each opens the full image. */
export function ScreenshotList({ items, onRemove }: { items: Attachment[]; onRemove?: (id: string) => void }) {
  const { t } = useI18n();
  if (!items.length) return null;
  return (
    <ul className="screenshots">
      {items.map((item, i) => (
        <li key={item.id}>
          <a href={item.url} target="_blank" rel="noopener noreferrer" aria-label={t("shots.open", { n: i + 1 })}>
            <img src={item.url} alt={t("shots.alt", { n: i + 1 })} loading="lazy" />
          </a>
          {onRemove && (
            <button type="button" className="screenshot-remove" aria-label={t("shots.remove")} onClick={() => onRemove(item.id)}>
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** "Add a screenshot": camera or gallery on a phone, compressed, then uploaded straight to the bucket. */
export function AddScreenshot({
  runId,
  scenarioKey,
  remaining,
  onAdded,
  onError,
}: {
  runId: string;
  scenarioKey: string;
  /** How many more screenshots this result can take. */
  remaining: number;
  onAdded: () => void;
  onError: (err: unknown) => void;
}) {
  const { t } = useI18n();
  const { api } = useSession();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    let added = 0;
    try {
      // Extra picks beyond the limit are left out rather than failing halfway.
      for (const file of Array.from(files).slice(0, remaining)) {
        const blob = await compress(file);
        const { attachment, upload } = await api.startAttachment(runId, scenarioKey, "image/jpeg");
        const form = new FormData();
        for (const [name, value] of Object.entries(upload.fields)) form.append(name, value);
        form.append("file", blob, "screenshot.jpg");
        const response = await fetch(upload.url, { method: "POST", body: form });
        if (!response.ok) throw new Error(t("shots.uploadFailed"));
        await api.completeAttachment(attachment.id);
        added++;
      }
    } catch (err) {
      const known = err instanceof Error && (err.message === "too_large" || err.message === "unreadable");
      onError(known ? new Error(t(err.message === "too_large" ? "shots.tooLarge" : "shots.unreadable")) : err);
    } finally {
      // Show what did upload, even if a later file failed.
      if (added) onAdded();
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <label className={`button button-small${busy ? " is-busy" : ""}`}>
      {busy ? t("shots.uploading") : t("shots.add")}
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        disabled={busy}
        onChange={(e) => void upload(e.target.files)}
      />
    </label>
  );
}
