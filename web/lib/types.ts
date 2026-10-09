export type JobStatus = "queued" | "processing" | "completed" | "failed";
export type MediaType = "image" | "video";

export type Job = {
  id: string;
  status: JobStatus;
  media_type: MediaType;
  original_filename: string;
  output_url: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string | null;
};
