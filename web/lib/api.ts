import { Job } from "./types";

const GUEST_TOKEN_KEY = "media_tool_guest_token";
const USER_NOT_FOUND_DETAIL = "User not found";
let pendingGuestToken: Promise<string> | null = null;

const DIRECT_API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/$/, "");
const DIRECT_MEDIA_BASE_URL = (process.env.NEXT_PUBLIC_MEDIA_BASE_URL || DIRECT_API_BASE_URL).replace(/\/$/, "");

function apiUrl(path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;

  if (!DIRECT_API_BASE_URL) {
    return suffix;
  }

  return `${DIRECT_API_BASE_URL}${suffix}`;
}

type GuestAuthResponse = {
  access_token: string;
};

type InitUploadResponse = {
  input_key: string;
  upload_url: string;
  expires_in: number;
};

type ErrorResponse = {
  detail?: string;
};

function clearGuestToken(): void {
  window.localStorage.removeItem(GUEST_TOKEN_KEY);
  pendingGuestToken = null;
}

function withAuthorizationHeader(init: RequestInit | undefined, token: string): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return {
    ...init,
    headers,
  };
}

async function shouldRefreshGuestToken(response: Response): Promise<boolean> {
  if (response.status !== 401) {
    return false;
  }

  try {
    const payload = (await response.clone().json()) as ErrorResponse;
    return payload.detail === USER_NOT_FOUND_DETAIL;
  } catch {
    return false;
  }
}

async function guestFetch(input: string, init?: RequestInit): Promise<Response> {
  const token = await getGuestToken();
  let response = await fetch(input, withAuthorizationHeader(init, token));

  if (!(await shouldRefreshGuestToken(response))) {
    return response;
  }

  clearGuestToken();
  const refreshedToken = await getGuestToken();
  response = await fetch(input, withAuthorizationHeader(init, refreshedToken));
  return response;
}

async function getGuestToken(): Promise<string> {
  const existing = window.localStorage.getItem(GUEST_TOKEN_KEY);
  if (existing) {
    return existing;
  }

  if (!pendingGuestToken) {
    pendingGuestToken = fetch(apiUrl("/api/auth/guest"), { method: "POST" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to create guest token: ${response.status}`);
        }

        const payload = (await response.json()) as GuestAuthResponse;
        window.localStorage.setItem(GUEST_TOKEN_KEY, payload.access_token);
        return payload.access_token;
      })
      .finally(() => {
        pendingGuestToken = null;
      });
  }

  return pendingGuestToken;
}

function formatLocalizedTimestamp(format: "time" | "date_time"): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");

  if (format === "time") {
    return `${hours}:${minutes}:${seconds}`;
  }

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export async function createJob(input: {
  file: File;
  requestedWidth?: number;
  watermarkText?: string;
  textOverlays?: Array<{
    text: string;
    x: number;
    y: number;
    fontSize: number;
    color: string;
  }>;
  includeCurrentTime?: boolean;
  timestampFormat?: "time" | "date_time";
  onUploadProgress?: (percent: number) => void;
}): Promise<Job> {
  const uploadInitResponse = await guestFetch(apiUrl("/api/jobs/upload-url"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      filename: input.file.name,
      content_type: input.file.type || "application/octet-stream",
    }),
  });

  if (!uploadInitResponse.ok) {
    throw new Error(`Failed to initialize upload: ${uploadInitResponse.status}`);
  }

  const uploadInit = (await uploadInitResponse.json()) as InitUploadResponse;

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadInit.upload_url);
    xhr.setRequestHeader("Content-Type", input.file.type || "application/octet-stream");

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return;
      }

      const percent = Math.max(0, Math.min(95, Math.round((event.loaded / event.total) * 95)));
      input.onUploadProgress?.(percent);
    };

    xhr.onerror = () => {
      reject(new Error("Failed to upload media to S3"));
    };

    xhr.onload = () => {
      const status = xhr.status;
      if (status < 200 || status >= 300) {
        reject(new Error(`Failed to upload media to S3: ${status}`));
        return;
      }

      resolve();
    };

    xhr.send(input.file);
  });

  const body: Record<string, unknown> = {
    input_key: uploadInit.input_key,
    original_filename: input.file.name,
    content_type: input.file.type || "application/octet-stream",
  };

  if (input.requestedWidth) {
    body.requested_width = input.requestedWidth;
  }

  if (input.watermarkText) {
    body.watermark_text = input.watermarkText;
  }

  if (input.textOverlays && input.textOverlays.length > 0) {
    body.text_overlays = input.textOverlays.map((overlay) => ({
      text: overlay.text,
      x: overlay.x,
      y: overlay.y,
      font_size: overlay.fontSize,
      color: overlay.color,
    }));
  }

  if (input.includeCurrentTime) {
    const effectiveFormat = input.timestampFormat || "date_time";
    body.include_current_time = true;
    body.timestamp_format = effectiveFormat;
    body.current_time_text = formatLocalizedTimestamp(effectiveFormat);
  }

  const response = await guestFetch(apiUrl("/api/jobs"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Failed to create job: ${response.status}`);
  }

  input.onUploadProgress?.(100);

  return response.json();
}

export async function fetchJob(jobId: string): Promise<Job> {
  const response = await guestFetch(apiUrl(`/api/jobs/${jobId}`));

  if (!response.ok) {
    throw new Error(`Failed to fetch job: ${response.status}`);
  }

  return response.json();
}

export async function fetchJobs(): Promise<Job[]> {
  const response = await guestFetch(apiUrl("/api/jobs"), { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Failed to fetch jobs: ${response.status}`);
  }

  return response.json();
}

export async function deleteAllJobs(): Promise<{ deleted: number }> {
  const response = await guestFetch(apiUrl("/api/jobs"), {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(`Failed to delete jobs: ${response.status}`);
  }

  return response.json();
}

export function toPublicMediaUrl(path: string | null): string | null {
  if (!path) {
    return null;
  }

  if (path.startsWith("http")) {
    return path;
  }

  if (DIRECT_MEDIA_BASE_URL && path.startsWith("/")) {
    return `${DIRECT_MEDIA_BASE_URL}${path}`;
  }

  return path;
}
