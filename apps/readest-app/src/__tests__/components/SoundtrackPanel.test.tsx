import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

import { SoundtrackControl } from '@/components/reader/SoundtrackControl';
import { SoundtrackPanel } from '@/components/reader/SoundtrackPanel';
import { useSoundtrackStore } from '@/store/soundtrackStore';
import * as capabilityModule from '@/services/bookscore/capability';
import * as persistenceModule from '@/services/bookscore/persistence';
import { InstalledPackage, LocalAssociation } from '@/services/bookscore/types';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string, params?: Record<string, unknown>) => {
    if (!params) return s;
    let res = s;
    for (const [k, v] of Object.entries(params)) {
      res = res.replace(`{${k}}`, String(v));
    }
    return res;
  },
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    appService: {
      isMobile: false,
    },
  }),
}));

describe('SoundtrackControl & SoundtrackPanel (Issue #15)', () => {
  const samplePkg: InstalledPackage = {
    packageId: 'pkg-verified-1',
    manifestHash: 'hash-1',
    installedAt: Date.now(),
    manifest: {
      packageId: 'pkg-verified-1',
      title: 'Sample Verified Soundtrack',
      version: 1,
      manifestHash: 'hash-1',
      editionCompatibility: [
        {
          algorithm: 'readest-partial-md5-v1',
          digest: 'edition-123',
          epubByteLength: 1024,
        },
      ],
      assets: [],
      cues: [
        {
          id: 'cue-1',
          startCfi: 'epubcfi(/6/2!/4/2)',
          type: 'audio',
          assetId: 'asset-1',
          startSec: 0,
          loopStartSec: 0,
          loopEndSec: 10,
          volume: 1,
          crossfadeSec: 0.5,
        },
      ],
    },
  };

  const unverifiedPkg: InstalledPackage = {
    packageId: 'pkg-unverified-2',
    manifestHash: 'hash-2',
    installedAt: Date.now(),
    manifest: {
      packageId: 'pkg-unverified-2',
      title: 'Sample Unverified Soundtrack',
      version: 2,
      manifestHash: 'hash-2',
      editionCompatibility: [],
      assets: [],
      cues: [],
    },
  };

  const sampleAssoc: LocalAssociation = {
    editionId: 'edition-123',
    packageId: 'pkg-verified-1',
    manifestHash: 'hash-1',
    selected: true,
    trustState: 'verified',
  };

  beforeEach(() => {
    useSoundtrackStore.getState().resetSoundtrack();
    vi.spyOn(capabilityModule, 'isBookScoreCapabilityEnabled').mockReturnValue(true);
    vi.spyOn(persistenceModule, 'loadInstalledPackages').mockResolvedValue({
      'pkg-verified-1:hash-1': samplePkg,
      'pkg-unverified-2:hash-2': unverifiedPkg,
    });
    vi.spyOn(persistenceModule, 'loadLocalAssociations').mockResolvedValue({
      'edition-123': sampleAssoc,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders nothing on mobile or when capability is disabled (desktop gating)', () => {
    vi.spyOn(capabilityModule, 'isBookScoreCapabilityEnabled').mockReturnValue(false);
    useSoundtrackStore.getState().setCapabilityEnabled(false);

    const { container } = render(<SoundtrackControl isMobile={true} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders quiet reading-surface state control button in header bar', () => {
    useSoundtrackStore.getState().setCapabilityEnabled(true);
    useSoundtrackStore
      .getState()
      .loadSoundtrackForBook(
        'edition-123',
        { 'pkg-verified-1:hash-1': samplePkg },
        { 'edition-123': sampleAssoc },
      );

    const { getByRole, getByText } = render(<SoundtrackControl isMobile={false} />);

    const button = getByRole('button', { name: /soundtrack controls/i });
    expect(button).toBeDefined();
    expect(getByText('Paused')).toBeDefined();
  });

  it('toggles right-side panel on control click', () => {
    useSoundtrackStore.getState().setCapabilityEnabled(true);
    useSoundtrackStore
      .getState()
      .loadSoundtrackForBook(
        'edition-123',
        { 'pkg-verified-1:hash-1': samplePkg },
        { 'edition-123': sampleAssoc },
      );

    const { getByRole, queryByRole } = render(<SoundtrackControl isMobile={false} />);

    expect(queryByRole('dialog', { name: /soundtrack control panel/i })).toBeNull();

    const button = getByRole('button', { name: /soundtrack controls/i });
    fireEvent.click(button);

    expect(useSoundtrackStore.getState().isPanelOpen).toBe(true);
    expect(getByRole('dialog', { name: /soundtrack control panel/i })).toBeDefined();
  });

  it('displays explicit play/pause controls, volume slider, and attachment badges inside panel', async () => {
    useSoundtrackStore.getState().setCapabilityEnabled(true);
    useSoundtrackStore
      .getState()
      .loadSoundtrackForBook(
        'edition-123',
        { 'pkg-verified-1:hash-1': samplePkg },
        { 'edition-123': sampleAssoc },
      );
    useSoundtrackStore.getState().setPanelOpen(true);

    const { getByRole, getByLabelText, findByText } = render(
      <SoundtrackPanel editionId='edition-123' isMobile={false} />,
    );

    // Check dialog presence
    expect(getByRole('dialog', { name: /soundtrack control panel/i })).toBeDefined();

    // Check Play / Pause button
    const playBtn = getByRole('button', { name: /play soundtrack|resume soundtrack/i });
    expect(playBtn).toBeDefined();

    // Check Volume slider
    const volumeSlider = getByLabelText(/soundtrack volume slider/i) as HTMLInputElement;
    expect(volumeSlider).toBeDefined();
    expect(volumeSlider.value).toBe('1');

    // Change volume
    fireEvent.change(volumeSlider, { target: { value: '0.6' } });
    expect(useSoundtrackStore.getState().volume).toBe(0.6);

    // Wait for attachment candidate list to render
    const verifiedBadge = await findByText('Verified');
    expect(verifiedBadge).toBeDefined();

    const unverifiedBadge = await findByText('Unverified');
    expect(unverifiedBadge).toBeDefined();
  });

  it('closes panel when Escape key is pressed', () => {
    useSoundtrackStore.getState().setCapabilityEnabled(true);
    useSoundtrackStore
      .getState()
      .loadSoundtrackForBook(
        'edition-123',
        { 'pkg-verified-1:hash-1': samplePkg },
        { 'edition-123': sampleAssoc },
      );
    useSoundtrackStore.getState().setPanelOpen(true);

    render(<SoundtrackPanel editionId='edition-123' isMobile={false} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useSoundtrackStore.getState().isPanelOpen).toBe(false);
  });
});
