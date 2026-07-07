import { createModels, createProvider, envApiKeyAuth } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { piCatalogPath } from "../config.ts";
import type { Credential, CredentialStore, Model } from "@earendil-works/pi-ai";
import { getKeychainKey, setKeychainKey, deleteKeychainKey } from "../keychain.ts";

const keychainStore: CredentialStore = {
  async read(providerId) {
    const key = getKeychainKey(providerId);
    if (key) return { type: "api_key", key };
    return undefined;
  },
  async modify(providerId, fn) {
    const current = await keychainStore.read(providerId);
    const next = await fn(current);
    if (next?.type === "api_key" && next.key) {
      setKeychainKey(providerId, next.key);
    }
    return next;
  },
  async delete(providerId) {
    deleteKeychainKey(providerId);
  },
};

export async function buildModels(provider: string, modelId: string): Promise<{
  models: ReturnType<typeof createModels>;
  model: Model<any>;
}> {
  const models = createModels({ credentials: keychainStore });

  for (const p of builtinProviders()) models.setProvider(p);

  const catalogPath = piCatalogPath();
  if (existsSync(catalogPath)) {
    try {
      const catalog = JSON.parse(await readFile(catalogPath, "utf-8"));
      if (catalog?.providers) {
        for (const [id, pDef] of Object.entries(catalog.providers) as [string, any][]) {
          const baseUrl = pDef.baseUrl;
          const api = pDef.api || "openai-completions";
          if (api !== "openai-completions") continue;

          const prov = createProvider({
            id,
            baseUrl,
            auth: { apiKey: envApiKeyAuth(id, [`${id.toUpperCase()}_API_KEY`]) },
            models: (pDef.models || []).map((m: any) => ({
              id: m.id,
              name: m.name || m.id,
              api,
              provider: id,
              baseUrl,
              reasoning: !!m.reasoning,
              input: m.input || ["text"],
              contextWindow: m.contextWindow || 128000,
              maxTokens: m.maxTokens || 32000,
              cost: m.cost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              ...(m.compat ? { compat: m.compat } : {}),
              ...(m.thinkingLevelMap ? { thinkingLevelMap: m.thinkingLevelMap } : {}),
            })),
            api: openAICompletionsApi(),
          });
          models.setProvider(prov);
        }
      }
    } catch (err) {
      console.error(`nyanclaw: failed to load ${catalogPath}:`, err);
    }
  }

  const pUpper = provider as any;
  const model = models.getModel(pUpper, modelId);
  if (!model) {
    throw new Error(
      `Model "${provider}/${modelId}" not found. Available providers: ${models.getProviders().join(", ")}`,
    );
  }

  return { models, model };
}
