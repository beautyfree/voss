// ── Core entities ──

export interface Server {
  id: string;
  ip: string;
  name: string;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  framework: FrameworkId;
  serverId: string;
  domain: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Deployment {
  id: string;
  projectId: string;
  status: DeploymentStatus;
  commitSha: string | null;
  branch: string | null;
  runnerImage: string;
  buildCommand: string;
  startCommand: string;
  containerId: string | null;
  containerName: string | null;
  logPath: string | null;
  // Snapshot: frozen at deploy time for rollback
  envVarsSnapshot: Record<string, string>;
  configSnapshot: VossConfig;
  createdAt: string;
  finishedAt: string | null;
}

export type DeploymentStatus =
  | "queued"
  | "uploading"
  | "building"
  | "deploying"
  | "health_checking"
  | "live"
  | "failed"
  | "rolled_back";

export interface Domain {
  id: string;
  projectId: string;
  hostname: string;
  sslStatus: "pending" | "active" | "error";
  createdAt: string;
}

export interface EnvVar {
  id: string;
  projectId: string;
  key: string;
  value: string;
  isBuildTime: boolean;
}

export interface Alias {
  id: string;
  projectId: string;
  subdomain: string;
  deploymentId: string;
  previousDeploymentId: string | null;
  type: "production" | "preview";
}

// ── Config ──

export interface VossConfig {
  name: string;
  framework?: FrameworkId;
  rootDirectory?: string;
  buildCommand?: string;
  startCommand?: string;
  outputDirectory?: string;
  env?: Record<string, string>;
  domains?: string[];
  resources?: {
    memory?: string;
    cpu?: number;
  };
  healthCheck?: {
    path?: string;
    timeout?: number;
  };
}

// ── API errors ──

export type ErrorCode =
  | "BUILD_FAILED"
  | "HEALTH_CHECK_FAILED"
  | "DISK_FULL"
  | "INVALID_CONFIG"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "SERVER_ERROR"
  | "UPLOAD_TOO_LARGE"
  | "QUEUE_FULL"
  | "CONTAINER_ERROR";

export interface ApiError {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export interface ApiSuccess<T> {
  data: T;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ── Framework detection ──

export type FrameworkId =
  | "nextjs"
  | "vite"
  | "astro"
  | "remix"
  | "nuxt"
  | "svelte"
  | "static"
  | "bun"
  | "node"
  | "unknown";

// ── Deploy protocol ──

export interface FileManifest {
  files: Record<string, string>; // relativePath -> sha256
  totalSize: number;
}

export interface MissingFilesResponse {
  missing: string[]; // sha256 hashes server doesn't have
}

// ── WebSocket messages ──

export type WsMessage =
  | { type: "log"; data: string }
  | { type: "status"; status: DeploymentStatus }
  | { type: "url"; url: string }
  | { type: "error"; error: ApiError };
