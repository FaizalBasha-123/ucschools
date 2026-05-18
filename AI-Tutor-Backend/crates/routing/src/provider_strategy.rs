/// Provider selection and fallback strategy.

/// The preferred provider for a given model capability.
/// This determines which API key / base URL configuration to use.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderPreference {
    /// Use the explicit provider from the model string (e.g. "openrouter:..." → OpenRouter).
    /// This is the default — always use what the model string says.
    AsSpecified,
    /// Force a specific provider override regardless of model string prefix.
    Force(&'static str),
}

/// Strategy for selecting and falling back between providers.
#[derive(Debug, Clone)]
pub struct ProviderStrategy {
    /// How to select the primary provider.
    pub preference: ProviderPreference,
    /// Ordered list of fallback provider IDs to try if the primary fails.
    pub fallbacks: &'static [&'static str],
}

impl Default for ProviderStrategy {
    fn default() -> Self {
        Self {
            preference: ProviderPreference::AsSpecified,
            fallbacks: &[],
        }
    }
}

impl ProviderStrategy {
    /// Create a strategy that uses the model string's provider as-is.
    pub const fn as_specified() -> Self {
        Self {
            preference: ProviderPreference::AsSpecified,
            fallbacks: &[],
        }
    }

    /// Create a strategy with fallback providers.
    pub const fn with_fallback(fallbacks: &'static [&'static str]) -> Self {
        Self {
            preference: ProviderPreference::AsSpecified,
            fallbacks,
        }
    }

    /// Create a strategy that forces a specific provider.
    pub const fn force(provider: &'static str) -> Self {
        Self {
            preference: ProviderPreference::Force(provider),
            fallbacks: &[],
        }
    }
}

/// Default generation strategy: OpenRouter with no fallback.
pub const DEFAULT_GENERATION_STRATEGY: ProviderStrategy = ProviderStrategy::as_specified();

/// Lightweight task strategy: prefer Groq for speed, fallback to OpenRouter.
pub const LIGHTWEIGHT_STRATEGY: ProviderStrategy =
    ProviderStrategy::with_fallback(&["openrouter"]);

/// Media generation strategy: use model string as specified (OpenAI / OpenRouter).
pub const MEDIA_STRATEGY: ProviderStrategy = ProviderStrategy::as_specified();
