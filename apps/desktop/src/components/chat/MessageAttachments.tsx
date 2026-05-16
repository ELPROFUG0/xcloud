import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BaseDirectory, readTextFile } from "@tauri-apps/plugin-fs";
import type { BrowserEngine } from "@/lib/engine";
import type { ChatAttachment } from "@/types/chat";
import { Attachment, AttachmentInfo, AttachmentPreview, Attachments } from "../ai-elements/attachments";
import type { AttachmentData } from "../ai-elements/attachments";

export type ImagePreviewState = {
  url: string;
  alt: string;
};

function isAbsoluteHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function joinBaseUrl(baseUrl: string, path: string) {
  if (isAbsoluteHttpUrl(path) || path.startsWith("blob:") || path.startsWith("data:")) return path;
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function isLocalMediaSource(value: string) {
  if (!value) return false;
  if (isAbsoluteHttpUrl(value) || value.startsWith("blob:") || value.startsWith("data:")) return false;
  if (value.startsWith("/api/") || value.startsWith("/__openclaw__/")) return false;
  return value.startsWith("/") || value.startsWith("~/") || /^[A-Za-z]:[\\/]/.test(value);
}

function resolveAttachmentUrl(attachment: ChatAttachment, engine: BrowserEngine) {
  const rawUrl = attachment.url.trim();
  return isLocalMediaSource(rawUrl) ? rawUrl : joinBaseUrl(engine.httpBaseUrl, rawUrl);
}

function outgoingRecordId(url: string) {
  try {
    const parsed = new URL(url, window.location.origin);
    const segments = parsed.pathname.split("/");
    const outgoingIndex = segments.indexOf("outgoing");
    const recordId = outgoingIndex >= 0 ? segments[outgoingIndex + 2] : undefined;
    return recordId ? decodeURIComponent(recordId) : undefined;
  } catch {
    return undefined;
  }
}

async function readOutgoingRecordAssetUrl(url: string) {
  const recordId = outgoingRecordId(url);
  if (!recordId) return null;

  const content = await readTextFile(`.openclaw/media/outgoing/records/${recordId}.json`, {
    baseDir: BaseDirectory.Home,
  }).catch(() => "");
  if (!content.trim()) return null;

  try {
    const record = JSON.parse(content) as { original?: { path?: string }; source?: { path?: string }; path?: string };
    return record.original?.path ?? record.source?.path ?? record.path ?? null;
  } catch {
    return null;
  }
}

const localMediaCache = new Map<string, string>();
const localMediaRequests = new Map<string, Promise<string | null>>();

function mediaTypeForPath(path: string) {
  if (/\.jpe?g(?:[?#].*)?$/i.test(path)) return "image/jpeg";
  if (/\.webp(?:[?#].*)?$/i.test(path)) return "image/webp";
  if (/\.gif(?:[?#].*)?$/i.test(path)) return "image/gif";
  if (/\.avif(?:[?#].*)?$/i.test(path)) return "image/avif";
  if (/\.svg(?:[?#].*)?$/i.test(path)) return "image/svg+xml";
  return "image/png";
}

async function localMediaObjectUrl(path: string) {
  if (localMediaCache.has(path)) return localMediaCache.get(path)!;
  if (localMediaRequests.has(path)) return localMediaRequests.get(path)!;

  const request = invoke<number[]>("read_openclaw_media", { path })
    .then((bytes) => {
      const objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mediaTypeForPath(path) }));
      localMediaCache.set(path, objectUrl);
      return objectUrl;
    })
    .catch(() => null)
    .finally(() => {
      localMediaRequests.delete(path);
    });

  localMediaRequests.set(path, request);
  return request;
}

async function resolveStableImageUrl(url: string, engine: BrowserEngine) {
  const resolvedUrl = isLocalMediaSource(url) ? url : joinBaseUrl(engine.httpBaseUrl, url);
  if (isLocalMediaSource(resolvedUrl)) return localMediaObjectUrl(resolvedUrl);
  if (resolvedUrl.includes("/api/chat/media/outgoing/")) {
    const localPath = await readOutgoingRecordAssetUrl(resolvedUrl);
    return localPath ? localMediaObjectUrl(localPath) : null;
  }
  return resolvedUrl;
}

function isImageAttachment(attachment: ChatAttachment) {
  return (attachment.mediaType ?? "").startsWith("image/") || /\.(?:png|jpe?g|gif|webp|avif|svg)(?:[?#].*)?$/i.test(attachment.url);
}

export function MessageAttachments({
  attachments,
  engine,
  align = "start",
  onPreviewImage,
}: {
  attachments: ChatAttachment[];
  engine: BrowserEngine;
  align?: "start" | "end";
  onPreviewImage: (preview: ImagePreviewState) => void;
}) {
  const imageCount = attachments.filter(isImageAttachment).length;
  return (
    <Attachments
      variant="grid"
      className={`mt-3 !grid !w-auto max-w-full grid-cols-[repeat(3,minmax(0,max-content))] gap-2 ${align === "end" ? "!ml-auto justify-end" : "!ml-0 justify-start"}`}
    >
      {attachments.map((attachment) => (
        <MessageAttachment
          key={attachment.id}
          attachment={attachment}
          engine={engine}
          imageCount={imageCount}
          onPreviewImage={onPreviewImage}
        />
      ))}
    </Attachments>
  );
}

function MessageAttachment({
  attachment,
  engine,
  imageCount,
  onPreviewImage,
}: {
  attachment: ChatAttachment;
  engine: BrowserEngine;
  imageCount: number;
  onPreviewImage: (preview: ImagePreviewState) => void;
}) {
  const resolvedUrl = useMemo(() => resolveAttachmentUrl(attachment, engine), [attachment, engine]);
  const [displayUrl, setDisplayUrl] = useState<string | null>(isImageAttachment(attachment) ? null : resolvedUrl);
  const isImage = isImageAttachment(attachment);

  useEffect(() => {
    let cancelled = false;
    if (!isImage) {
      setDisplayUrl(resolvedUrl);
      return;
    }

    setDisplayUrl(null);
    void resolveStableImageUrl(attachment.url, engine).then((stableUrl) => {
      if (!cancelled) setDisplayUrl(stableUrl);
    });

    return () => {
      cancelled = true;
    };
  }, [attachment.url, engine, isImage, resolvedUrl]);

  const data: AttachmentData = {
    id: attachment.id,
    type: "file",
    url: displayUrl ?? "",
    mediaType: attachment.mediaType ?? (isImage ? "image/*" : "application/octet-stream"),
    filename: attachment.filename ?? attachment.alt ?? "Attachment",
  };

  const openAttachment = (event: React.MouseEvent) => {
    event.preventDefault();
    import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(resolvedUrl)).catch(() => {});
  };

  if (isImage) {
    const imageSizeClass = imageCount <= 1
      ? "h-80 w-80 sm:h-96 sm:w-96"
      : imageCount === 2
        ? "h-40 w-40 sm:h-52 sm:w-52"
        : "h-28 w-28 sm:h-36 sm:w-36";
    return (
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          if (displayUrl) {
            onPreviewImage({
              url: displayUrl,
              alt: attachment.alt ?? attachment.filename ?? "Generated image",
            });
          }
        }}
        className="block max-w-full rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-white/20"
        aria-label="Open image preview"
      >
        <Attachment
          data={data}
          className={`${imageSizeClass} max-w-full overflow-hidden rounded-xl bg-transparent`}
        >
          {displayUrl ? (
            <AttachmentPreview className="size-full rounded-xl bg-transparent" />
          ) : (
            <div className="h-full w-full animate-pulse rounded-xl bg-white/5" />
          )}
        </Attachment>
      </button>
    );
  }

  return (
    <a
      href={resolvedUrl}
      onClick={openAttachment}
      className="block max-w-full rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-white/20"
    >
      <Attachment
        data={data}
        className="!size-auto max-w-full overflow-hidden rounded-xl border border-white/10 bg-[#212121]"
      >
        <div className="flex min-w-56 items-center gap-3 p-3 text-[12px] text-text">
          <AttachmentPreview />
          <AttachmentInfo showMediaType />
        </div>
      </Attachment>
    </a>
  );
}
