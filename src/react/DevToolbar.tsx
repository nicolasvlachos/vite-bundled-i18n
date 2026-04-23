import { useContext, useEffect } from 'react';
import { I18nContext } from './context';
import {
  mountI18nDevtools,
  type I18nDevtoolsOptions,
} from '../devtools/mountDevtools';

export type DevToolbarProps = I18nDevtoolsOptions;

/**
 * React convenience wrapper around the framework-neutral i18n devtools drawer.
 *
 * Mounts nothing in production and returns `null`. The actual UI is rendered
 * by the vanilla DOM devtools layer so it can be shared across React, Vue,
 * and vanilla JS apps.
 */
export function DevToolbar({
  mountTarget,
  getCurrentPath,
  getCurrentScope,
}: DevToolbarProps = {}) {
  const ctx = useContext(I18nContext);
  const instance = ctx?.instance;

  useEffect(() => {
    if (!instance) return;

    const handle = mountI18nDevtools(instance, {
      mountTarget,
      getCurrentPath,
      getCurrentScope,
    });

    return () => {
      handle.destroy();
    };
  }, [
    getCurrentPath,
    getCurrentScope,
    instance,
    mountTarget,
  ]);

  return null;
}
