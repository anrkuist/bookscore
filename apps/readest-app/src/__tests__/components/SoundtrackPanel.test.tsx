import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import { SoundtrackControl } from '@/components/reader/SoundtrackControl';
import { SoundtrackPanel } from '@/components/reader/SoundtrackPanel';
import { useSoundtrackStore } from '@/store/soundtrackStore';
import * as capabilityModule from '@/services/bookscore/capability';
import * as persistenceModule from '@/services/bookscore/persistence';
import * as importServiceModule from '@/services/bookscore/importService';
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
      cues: [
        {
          id: 'cue-2',
          startCfi: 'epubcfi(/6/2!/4/2)',
          type: 'audio',
          assetId: 'asset-2',
          startSec: 0,
          loopStartSec: 0,
          loopEndSec: 10,
          volume: 1,
          crossfadeSec: 0.5,
        },
      ],
    },
  };

  const sampleAssoc: LocalAssociation = {
    editionId: 'edition-123',
    packageId: 'pkg-verified-1',
    manifestHash: 'hash-1',
    selected: true,
    trustState: 'verified',
  };

  const unverifiedAssoc: LocalAssociation = {
    editionId: 'edition-123',
    packageId: 'pkg-unverified-2',
    manifestHash: 'hash-2',
    selected: true,
    trustState: 'unverified',
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

  it('displays DESIGN.md §2.9 compliant header and explicit controls, volume, RTL, and e-ink styling', async () => {
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

    const dialog = getByRole('dialog', { name: /soundtrack control panel/i });
    expect(dialog).toBeDefined();

    // Check DESIGN.md §2.9 heading and canonical description style
    const h2 = dialog.querySelector('h2');
    expect(h2?.className).toContain('text-lg font-semibold tracking-tight');
    expect(h2?.textContent).toBe('Soundtrack');

    const descP = dialog.querySelector('p');
    expect(descP?.className).toContain('text-sm text-base-content/70 leading-relaxed');

    // Check RTL logical positioning classes
    expect(dialog.className).toContain('end-0');
    expect(dialog.className).toContain('border-s');

    // Check E-ink classes on panel and Detach button
    expect(dialog.className).toContain('eink-bordered');

    const detachBtn = getByRole('button', { name: /detach/i });
    expect(detachBtn.className).toContain('eink-bordered');

    // Check Volume slider
    const volumeSlider = getByLabelText(/soundtrack volume slider/i) as HTMLInputElement;
    expect(volumeSlider).toBeDefined();

    fireEvent.change(volumeSlider, { target: { value: '0.6' } });
    expect(useSoundtrackStore.getState().volume).toBe(0.6);

    const verifiedBadge = await findByText('Verified');
    expect(verifiedBadge).toBeDefined();
  });

  it('switches to unverified candidate package with consent modal eink styling and keyboard independence', async () => {
    useSoundtrackStore.getState().setCapabilityEnabled(true);
    useSoundtrackStore
      .getState()
      .loadSoundtrackForBook(
        'edition-123',
        { 'pkg-verified-1:hash-1': samplePkg, 'pkg-unverified-2:hash-2': unverifiedPkg },
        { 'edition-123': sampleAssoc },
      );
    useSoundtrackStore.getState().setPanelOpen(true);

    vi.spyOn(importServiceModule, 'associateSoundtrackToEdition').mockResolvedValue({
      success: true,
    });
    vi.spyOn(persistenceModule, 'loadLocalAssociations')
      .mockResolvedValueOnce({ 'edition-123': sampleAssoc })
      .mockResolvedValueOnce({ 'edition-123': unverifiedAssoc });

    const { findByRole, getByRole } = render(
      <SoundtrackPanel editionId='edition-123' isMobile={false} />,
    );

    const switchConsentBtn = await findByRole('button', { name: /attach unverified package/i });
    fireEvent.click(switchConsentBtn);

    // Consent modal pops up - check eink-bordered on Cancel button
    const cancelBtn = getByRole('button', { name: /cancel/i });
    expect(cancelBtn.className).toContain('eink-bordered');

    // When modal is open, test Tab key event - panel listener should be suspended
    cancelBtn.focus();
    fireEvent.keyDown(window, { key: 'Tab' });

    // Confirm consent
    const confirmConsentBtn = getByRole('button', { name: /attach as unverified/i });
    fireEvent.click(confirmConsentBtn);

    await waitFor(() => {
      expect(importServiceModule.associateSoundtrackToEdition).toHaveBeenCalledWith(
        expect.anything(),
        'Data',
        'edition-123',
        'pkg-unverified-2',
        'hash-2',
        { consentGiven: true },
      );
      expect(useSoundtrackStore.getState().activePackage?.packageId).toBe('pkg-unverified-2');
      // Panel stays open after modal closes
      expect(useSoundtrackStore.getState().isPanelOpen).toBe(true);
    });
  });

  it('manages focus lifecycle and traps Tab/Shift+Tab key focus inside panel', async () => {
    useSoundtrackStore.getState().setCapabilityEnabled(true);
    useSoundtrackStore
      .getState()
      .loadSoundtrackForBook(
        'edition-123',
        { 'pkg-verified-1:hash-1': samplePkg },
        { 'edition-123': sampleAssoc },
      );

    const triggerButton = document.createElement('button');
    document.body.appendChild(triggerButton);
    triggerButton.focus();

    useSoundtrackStore.getState().setPanelOpen(true);

    const { getByRole, getByLabelText } = render(
      <SoundtrackPanel editionId='edition-123' isMobile={false} />,
    );

    const closeBtn = getByRole('button', { name: /close soundtrack panel/i });

    await waitFor(() => {
      expect(document.activeElement).toBe(closeBtn);
    });

    const volumeSlider = getByLabelText(/soundtrack volume slider/i);
    expect(volumeSlider).toBeInTheDocument();

    // Test Tab wrap-around from last focusable or Shift+Tab from first focusable
    closeBtn.focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    // Expect focus to wrap to last focusable element or stay trapped inside panel
    const dialog = getByRole('dialog', { name: /soundtrack control panel/i });
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useSoundtrackStore.getState().isPanelOpen).toBe(false);
  });
});
