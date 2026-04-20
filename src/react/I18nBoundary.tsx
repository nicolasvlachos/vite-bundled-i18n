import { type ReactNode } from 'react';
import { useI18n } from './useI18n';

export interface I18nBoundaryProps {
  /** Scope to load (e.g., 'products.index') */
  scope: string;
  /** Rendered while translations are loading */
  fallback?: ReactNode;
  /** Rendered once translations are ready */
  children: ReactNode;
}

/**
 * Boundary component that handles translation loading.
 * Children only render once the scope is ready, avoiding
 * rules-of-hooks violations from early returns in child components.
 *
 * @example
 * ```tsx
 * <I18nBoundary scope="products.index" fallback={<Spinner />}>
 *   <ProductsPage />
 * </I18nBoundary>
 * ```
 */
export function I18nBoundary({ scope, fallback = null, children }: I18nBoundaryProps) {
  const { ready } = useI18n(scope);

  if (!ready) return <>{fallback}</>;
  return <>{children}</>;
}
