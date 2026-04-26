import type { ESLint, Linter, Rule } from 'eslint';
import noTDynamic from './rules/no-t-dynamic';
import noNonLiteralTArg from './rules/no-non-literal-t-arg';
import noRenamedT from './rules/no-renamed-t';
import noMemberAccessT from './rules/no-member-access-t';
import tArgMustExistInTypes from './rules/t-arg-must-exist-in-types';

/**
 * Plugin metadata (consumed by ESLint when it lists installed plugins).
 *
 * Imported from `package.json` via the build-time `__VITE_BUNDLED_I18N_VERSION__`
 * macro defined in `vite.lib.config.ts` — keeps the version in lockstep with
 * the package without a separate runtime import.
 */
declare const __VITE_BUNDLED_I18N_VERSION__: string;
const PLUGIN_NAME = 'vite-bundled-i18n';

/**
 * The plugin's rule registry. Every rule is keyed by its short name (no
 * `vite-bundled-i18n/` prefix — the prefix is added by ESLint when the
 * plugin is referenced).
 */
const rules: Record<string, Rule.RuleModule> = {
  'no-t-dynamic': noTDynamic,
  'no-non-literal-t-arg': noNonLiteralTArg,
  'no-renamed-t': noRenamedT,
  'no-member-access-t': noMemberAccessT,
  't-arg-must-exist-in-types': tArgMustExistInTypes,
};

/**
 * Configurations exposed via `extends`/`flat config` consumption.
 *
 * The `recommended` preset turns on the four extractor-invisibility
 * rules as warnings — enough to surface every blind spot without
 * blocking development. `t-arg-must-exist-in-types` is intentionally
 * NOT in `recommended` because it requires `localesDir` /
 * `defaultLocale` config and produces noise on bootstrap projects.
 *
 * The `strict` preset turns every rule to `error` AND turns on
 * `t-arg-must-exist-in-types` with sensible defaults. Use it on CI
 * for projects that have a stable locale layout.
 *
 * Both flat-config (`flatConfigs.*`) and legacy (`configs.*`) shapes
 * are exported. ESLint 9+ uses flat by default; legacy is kept for
 * downstream consumers still on v8.
 */
const recommendedRules: Linter.RulesRecord = {
  [`${PLUGIN_NAME}/no-t-dynamic`]: 'warn',
  [`${PLUGIN_NAME}/no-non-literal-t-arg`]: 'warn',
  [`${PLUGIN_NAME}/no-renamed-t`]: 'warn',
  [`${PLUGIN_NAME}/no-member-access-t`]: 'warn',
};

const strictRules: Linter.RulesRecord = {
  [`${PLUGIN_NAME}/no-t-dynamic`]: 'error',
  [`${PLUGIN_NAME}/no-non-literal-t-arg`]: 'error',
  [`${PLUGIN_NAME}/no-renamed-t`]: 'error',
  [`${PLUGIN_NAME}/no-member-access-t`]: 'error',
  // Defaults match the extractor: locales/<defaultLocale>/. Override
  // by re-declaring the rule in your own ESLint config:
  //   'vite-bundled-i18n/t-arg-must-exist-in-types': ['error', { localesDir: 'i18n', defaultLocale: 'en-US' }],
  [`${PLUGIN_NAME}/t-arg-must-exist-in-types`]: ['error', { localesDir: 'locales', defaultLocale: 'en' }],
};

const plugin = {
  meta: {
    name: PLUGIN_NAME,
    version: typeof __VITE_BUNDLED_I18N_VERSION__ === 'string' ? __VITE_BUNDLED_I18N_VERSION__ : '0.0.0',
  },
  rules,
} as unknown as ESLint.Plugin;

/**
 * Flat-config preset shape (ESLint 9+):
 *   import i18nPlugin from 'vite-bundled-i18n/eslint';
 *   export default [i18nPlugin.flatConfigs.recommended];
 *
 * Annotated with explicit `Linter.Config` because TypeScript's inferred
 * type would reach into `@eslint/core` internals and break declaration
 * portability (TS2883 — "cannot be named without a reference to ...").
 */
interface FlatConfigs {
  recommended: Linter.Config;
  strict: Linter.Config;
}

const flatConfigs: FlatConfigs = {
  recommended: {
    name: `${PLUGIN_NAME}/recommended`,
    plugins: { [PLUGIN_NAME]: plugin },
    rules: recommendedRules,
  },
  strict: {
    name: `${PLUGIN_NAME}/strict`,
    plugins: { [PLUGIN_NAME]: plugin },
    rules: strictRules,
  },
};

/**
 * Legacy-config preset (ESLint 8):
 *   { extends: ['plugin:vite-bundled-i18n/recommended'] }
 *
 * The legacy shape doesn't carry `plugins` inline — the consumer registers
 * the plugin separately and references it by string name.
 */
interface LegacyConfigs {
  recommended: { plugins: string[]; rules: Linter.RulesRecord };
  strict: { plugins: string[]; rules: Linter.RulesRecord };
}

const configs: LegacyConfigs = {
  recommended: {
    plugins: [PLUGIN_NAME],
    rules: recommendedRules,
  },
  strict: {
    plugins: [PLUGIN_NAME],
    rules: strictRules,
  },
};

/**
 * The exported shape combines the standard `ESLint.Plugin` (which includes
 * a `configs?: Record<string, ...>` field for legacy presets) with our
 * `flatConfigs` namespace. `configs` is left wide-typed as `ESLint.Plugin`
 * defines it; the named export below gives consumers the precise shape if
 * they prefer it.
 */
interface I18nPluginExport extends ESLint.Plugin {
  flatConfigs: FlatConfigs;
}

const exported: I18nPluginExport = {
  ...plugin,
  flatConfigs,
  configs: configs as unknown as ESLint.Plugin['configs'],
};

export default exported;
export { rules, flatConfigs, configs };
