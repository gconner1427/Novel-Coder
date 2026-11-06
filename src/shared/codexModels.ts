import type { CodexCatalog, CodexModel } from './types'

export function codexModel(catalog: CodexCatalog | null, model: string): CodexModel | undefined {
  return catalog?.models.find((m) => m.id === (model === 'default' ? catalog.defaultModel : model))
}

export function codexAutoEffort(catalog: CodexCatalog | null, model: string): string | undefined {
  const entry = codexModel(catalog, model)
  const configured = catalog?.configuredEffort
  return configured && (!entry || entry.supportedReasoningEfforts.some((e) => e.reasoningEffort === configured))
    ? configured
    : entry?.defaultReasoningEffort
}

/** Preserve custom models; discard an effort only when the runtime says it is unsupported. */
export function compatibleCodexEffort(catalog: CodexCatalog | null, model: string, effort: string): string {
  const entry = codexModel(catalog, model)
  return entry && effort && !entry.supportedReasoningEfforts.some((e) => e.reasoningEffort === effort) ? '' : effort
}
