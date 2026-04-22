/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the backend API (e.g. "https://api.example.com").
   * Unset for same-origin deployments; required when the frontend
   * (S3 + CloudFront) lives on a different origin from the API (ALB). */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
