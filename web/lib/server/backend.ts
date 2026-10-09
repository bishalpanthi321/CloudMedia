const DEFAULT_BACKEND_URL = "http://localhost:33002";

export function backendBaseUrl(): string {
  return process.env.API_INTERNAL_BASE_URL || process.env.BACKEND_API_URL || DEFAULT_BACKEND_URL;
}

export function backendUrl(path: string): string {
  const base = backendBaseUrl().replace(/\/$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}
