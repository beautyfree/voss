import { treaty } from "@elysiajs/eden";
import type { App } from "@voss/server";

const API_URL = import.meta.env.VITE_API_URL ?? window.location.origin;
const API_KEY = import.meta.env.VITE_API_KEY ?? localStorage.getItem("voss_api_key") ?? "";

// Typed Eden Treaty client — end-to-end type safety from Elysia routes
export const client = treaty<App>(API_URL, {
  headers: {
    Authorization: `Bearer ${API_KEY}`,
  },
});

// Legacy helper for migration — same fetch wrapper as before
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const resp = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
      ...options.headers,
    },
  });

  const json = await resp.json();

  if (!resp.ok) {
    throw new Error(json.message ?? `API error ${resp.status}`);
  }

  return json.data;
}
