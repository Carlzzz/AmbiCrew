import { useSettingsStore } from '../stores/settingsStore'
import { useProviderStore } from '../stores/providerStore'
import type { RuntimeSelection } from '../types/runtime'

/**
 * Infer the default runtime selection from current settings + active provider.
 *
 * Validates `currentModel` against `availableModels` and falls back to the
 * active provider's default `main` model (CrewCentral) when `currentModel` is
 * stale - e.g. after switching providers the previously-selected model may no
 * longer be valid.
 *
 * Shared by EmptySession and the ActiveSession "new project" button so both
 * pages resolve the same default model.
 */
export async function inferDefaultRuntimeSelection(): Promise<RuntimeSelection> {
  const settings = useSettingsStore.getState()
  let providerState = useProviderStore.getState()
  if (
    settings.activeProviderName &&
    providerState.providers.length === 0 &&
    !providerState.isLoading
  ) {
    await providerState.fetchProviders()
    providerState = useProviderStore.getState()
  }

  const inferredProviderId = providerState.activeId ?? (
    settings.activeProviderName
      ? providerState.providers.find((provider) => provider.name === settings.activeProviderName)?.id ?? null
      : null
  )
  // For CrewCentral (provider-managed), prefer the provider's default model
  // over availableModels[0] / a stale currentModel that isn't valid on CrewProxy.
  const availableIds = settings.availableModels.map((m) => m.id)
  const isCurrentModelValid = !!settings.currentModel?.id && availableIds.includes(settings.currentModel.id)
  const inferredProvider = inferredProviderId
    ? providerState.providers.find((provider) => provider.id === inferredProviderId) ?? null
    : null
  const defaultProviderModel = inferredProvider?.models.main.trim()
  const isDefaultProviderModelValid = !!defaultProviderModel && (
    availableIds.length === 0 || availableIds.includes(defaultProviderModel)
  )

  const modelId = isCurrentModelValid
    ? settings.currentModel!.id
    : inferredProvider?.presetId === 'crewcentral' && isDefaultProviderModelValid
      ? defaultProviderModel
      : ''

  return { providerId: inferredProviderId, modelId }
}
