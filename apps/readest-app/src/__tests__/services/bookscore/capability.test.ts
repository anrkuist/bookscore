import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isBookScoreCapabilityEnabled } from '@/services/bookscore/capability';
import * as environmentModule from '@/services/environment';

describe('BookScore Capability Gating (Issue #29)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('always returns false on Web platform (isTauriAppPlatform returns false)', () => {
    vi.spyOn(environmentModule, 'isTauriAppPlatform').mockReturnValue(false);
    expect(isBookScoreCapabilityEnabled()).toBe(false);
    expect(isBookScoreCapabilityEnabled({ isMobile: false })).toBe(false);
    expect(isBookScoreCapabilityEnabled({ isMobile: true })).toBe(false);
  });

  it('always returns false on Mobile platforms (isMobile is true)', () => {
    vi.spyOn(environmentModule, 'isTauriAppPlatform').mockReturnValue(true);
    expect(isBookScoreCapabilityEnabled({ isMobile: true })).toBe(false);
  });

  it('returns true on Desktop Tauri platforms', () => {
    vi.spyOn(environmentModule, 'isTauriAppPlatform').mockReturnValue(true);
    expect(isBookScoreCapabilityEnabled()).toBe(true);
    expect(isBookScoreCapabilityEnabled({ isMobile: false })).toBe(true);
  });

  it('returns false when explicit settings disable the capability', () => {
    vi.spyOn(environmentModule, 'isTauriAppPlatform').mockReturnValue(true);
    expect(isBookScoreCapabilityEnabled({ enableBookScoreSetting: false })).toBe(false);
    expect(isBookScoreCapabilityEnabled({ isMobile: false, enableBookScoreSetting: false })).toBe(
      false,
    );
  });
});
