import { refererHeader, titleHeader } from "../config";

const MODELS_ENDPOINT = "https://openrouter.ai/api/v1/models";
const MODELS_RETRY_DELAY_MS = 300;
const MODELS_MAX_ATTEMPTS = 3;

export interface OpenRouterModelEntry {
  id: string;
  name?: string | null;
  description?: string | null;
  pricing?: {
    prompt?: string | number | null;
    completion?: string | number | null;
    request?: string | number | null;
  } | null;
  supported_parameters?: string[] | null;
}

interface OpenRouterModelsResponse {
  data?: OpenRouterModelEntry[];
}

export interface ModelListItem {
  id: string;
  name: string;
  description: string | null;
  provider: string | null;
  promptPrice: string | null;
  completionPrice: string | null;
  requestPrice: string | null;
  supportsReasoning: boolean;
}

export function normalizeOpenRouterModel(entry: OpenRouterModelEntry): ModelListItem {
  const provider = entry.id.includes("/") ? entry.id.split("/")[0] ?? null : null;
  return {
    id: entry.id,
    name: normalizeString(entry.name) ?? entry.id,
    description: normalizeString(entry.description),
    provider,
    promptPrice: normalizePrice(entry.pricing?.prompt),
    completionPrice: normalizePrice(entry.pricing?.completion),
    requestPrice: normalizePrice(entry.pricing?.request),
    supportsReasoning: Boolean(
      entry.supported_parameters?.some((parameter) => {
        const normalized = parameter.toLowerCase();
        return normalized === "reasoning" || normalized === "include_reasoning";
      }),
    ),
  };
}

export function isGpt5Model(model: Pick<ModelListItem, "id" | "name">): boolean {
  const haystack = `${model.id} ${model.name ?? ""}`.toLowerCase();
  return haystack.includes("gpt-5");
}

export async function fetchOpenRouterModels(apiKey?: string): Promise<ModelListItem[]> {
  const normalizedKey = apiKey?.trim();
  if (!normalizedKey) {
    throw new Error("OpenRouter API key required to load the full model catalog.");
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "HTTP-Referer": refererHeader,
    "X-Title": titleHeader,
    Authorization: `Bearer ${normalizedKey}`,
  };

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MODELS_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(MODELS_ENDPOINT, {
        headers,
        cache: "no-store",
      });
      if (!response.ok) {
        if (shouldRetryModelsRequest(response.status) && attempt < MODELS_MAX_ATTEMPTS) {
          await sleep(MODELS_RETRY_DELAY_MS * attempt);
          continue;
        }
        throw new Error(`Failed to load OpenRouter models (status ${response.status}).`);
      }

      const payload = (await response.json()) as OpenRouterModelsResponse;
      if (!payload || !Array.isArray(payload.data)) {
        throw new Error("Unexpected response from OpenRouter models API.");
      }

      return payload.data
        .filter((entry): entry is OpenRouterModelEntry => typeof entry?.id === "string" && entry.id.length > 0)
        .map((entry) => normalizeOpenRouterModel(entry))
        .sort((a, b) => a.id.localeCompare(b.id));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MODELS_MAX_ATTEMPTS) {
        await sleep(MODELS_RETRY_DELAY_MS * attempt);
        continue;
      }
    }
  }

  throw lastError ?? new Error("Failed to load OpenRouter models.");
}

function shouldRetryModelsRequest(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function normalizeString(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normalizePrice(value: string | number | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toString() : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  return null;
}
