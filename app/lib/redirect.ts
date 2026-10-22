/** Only a path on this site. Anything else (//host, \host, a full URL) falls back to home. */
export function safeRedirectPath(value: string | null | undefined): string {
  return value && /^\/(?![/\\])/.test(value) ? value : "/";
}
