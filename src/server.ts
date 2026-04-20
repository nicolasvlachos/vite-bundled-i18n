import { createI18n } from './core/createI18n';
import { createTranslations } from './core/getTranslations';
import type {
  I18nConfig,
  I18nInstance,
  NestedTranslations,
  Translations,
} from './core/types';

/**
 * Applies pre-loaded resources to an i18n instance.
 * Used internally by React and Vue adapters for auto-hydration.
 */
export function applyServerResources(
  instance: I18nInstance,
  resources: Record<string, NestedTranslations>,
  locale = instance.getLocale(),
): void {
  for (const [namespace, data] of Object.entries(resources)) {
    instance.addResources(locale, namespace, data);
  }
}

/**
 * Serializes translation resources into a `<script>` tag for SSR hydration.
 */
function serializeResources(
  resources: Record<string, NestedTranslations>,
  locale: string,
): string {
  const json = JSON.stringify({ locale, resources });
  const safe = json.replace(/</g, '\\u003c');
  return `<script>window.__I18N_RESOURCES__=${safe}</script>`;
}

function inferScopeNamespace(scope: string): string {
  return scope.includes('.') ? scope.slice(0, scope.indexOf('.')) : scope;
}

/**
 * Server-side i18n initialization. Creates an instance, loads dictionaries
 * and optional scope, and returns everything needed for SSR.
 *
 * @example
 * ```ts
 * const { translations, scriptTag } = await initServerI18n(config, 'products.show');
 * const html = renderToString(<App translations={translations} />);
 * // Inject scriptTag into the HTML <head> or <body>
 * ```
 */
export async function initServerI18n(
  config: I18nConfig,
  scope?: string,
  locale?: string,
): Promise<{
  translations: Translations;
  scriptTag: string;
  instance: I18nInstance;
}> {
  const instance = createI18n(locale ? { ...config, locale } : config);
  const activeLocale = instance.getLocale();

  await instance.loadAllDictionaries(activeLocale);
  if (scope) {
    await instance.loadScope(activeLocale, scope);
  }

  const namespaces = new Set<string>(instance.getDictionaryNamespaces());
  if (scope) {
    namespaces.add(inferScopeNamespace(scope));
  }

  const resources: Record<string, NestedTranslations> = {};
  for (const namespace of namespaces) {
    const data = instance.getResource(activeLocale, namespace);
    if (data) {
      resources[namespace] = data;
    }
  }

  return {
    translations: createTranslations(instance, activeLocale),
    scriptTag: serializeResources(resources, activeLocale),
    instance,
  };
}
