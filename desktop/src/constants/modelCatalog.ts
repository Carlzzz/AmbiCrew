import type { ModelInfo } from '../types/settings'

// Default models are now sourced from CrewProxy when connected, or from the
// server API which pulls from the active provider / central auth configuration.
// These hardcoded fallbacks are only used when no other source is available.
export const OFFICIAL_DEFAULT_MODEL_ID = ''

export const OFFICIAL_MODELS: ModelInfo[] = []
