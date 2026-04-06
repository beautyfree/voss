const API_URL = import.meta.env.VITE_API_URL ?? "";
const API_KEY = import.meta.env.VITE_API_KEY ?? localStorage.getItem("voss_api_key") ?? "";

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
