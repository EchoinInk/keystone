export const maxFileBytes = 25 * 1024 * 1024;
export const maxTextEditBytes = 1024 * 1024;

// Inline delivery has its own allowlist. HTML, SVG and other active formats
// always use the download route, regardless of their filename.
export function previewType(type: unknown, name: unknown) {
  const mime = String(type ?? "").split(";")[0].trim().toLowerCase();
  if (["text/plain", "text/markdown", "text/x-markdown"].includes(mime) ||
      ((!mime || mime === "application/octet-stream") && /\.(txt|md|markdown)$/i.test(String(name)))) return "text/plain";
  return ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mime) ? mime : null;
}
