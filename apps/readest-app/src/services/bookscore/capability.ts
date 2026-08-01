import { isTauriAppPlatform } from '@/services/environment';

export interface BookScoreCapabilityOptions {
  isMobile?: boolean;
  enableBookScoreSetting?: boolean;
}

/**
 * Evaluates whether the BookScore soundtrack capability is enabled for the current platform and user settings.
 * Returns true ONLY on Desktop platforms when the capability flag is active.
 * Always returns false on Web, iOS, and Android.
 */
export function isBookScoreCapabilityEnabled(options?: BookScoreCapabilityOptions): boolean {
  const isMobile = options?.isMobile ?? false;
  const isDesktop = isTauriAppPlatform() && !isMobile;
  if (!isDesktop) {
    return false;
  }
  if (options?.enableBookScoreSetting === false) {
    return false;
  }
  return true;
}
