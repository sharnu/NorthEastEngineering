/**
 * Triggers a browser save dialog for a Blob. Replaces the older
 * `<a href="/api/...">` pattern that bypassed the JWT auth interceptor and
 * 401'd in production for any role-protected CSV endpoint.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revocation so the click has time to start the download
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
