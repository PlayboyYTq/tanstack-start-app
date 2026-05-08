import { supabase } from "@/integrations/supabase/client";

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB

export type AttachmentKind = "image" | "video" | "file";

export type UploadResult = {
  url: string;
  kind: AttachmentKind;
  filename: string;
};

export function detectKind(file: File): AttachmentKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return "file";
}

/**
 * Upload an attachment to the public `chat-attachments` bucket under the user's folder.
 * Reports progress via XHR so the UI can show a real percentage.
 * Throws on failure; caller should wrap with try/catch + toast.
 */
export async function uploadAttachment(
  file: File,
  userId: string,
  onProgress?: (pct: number) => void,
): Promise<UploadResult> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error("File is larger than the 25MB limit.");
  }
  const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  // Get a signed upload URL so we can stream via XHR with progress events.
  const { data: signed, error: signErr } = await supabase.storage
    .from("chat-attachments")
    .createSignedUploadUrl(path);
  if (signErr || !signed) {
    // Fallback to standard upload (no progress) if signed URL fails
    onProgress?.(10);
    const { error } = await supabase.storage.from("chat-attachments").upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (error) throw error;
    onProgress?.(100);
  } else {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", signed.signedUrl, true);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.setRequestHeader("x-upsert", "false");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.(100);
          resolve();
        } else {
          reject(new Error(`Upload failed (${xhr.status})`));
        }
      };
      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.send(file);
    });
  }

  const { data } = supabase.storage.from("chat-attachments").getPublicUrl(path);
  return { url: data.publicUrl, kind: detectKind(file), filename: file.name };
}
