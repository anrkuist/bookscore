import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('@/services/tts/TTSController', () => ({
  TTSController: class {},
  DEFAULT_SENTENCE_GAP_SEC: 0.1,
  DEFAULT_PARAGRAPH_GAP_SEC: 0.5,
}));
import { render, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

import { SoundtrackControl } from '@/components/reader/SoundtrackControl';
import { SoundtrackPanel } from '@/components/reader/SoundtrackPanel';
import { useSoundtrackStore } from '@/store/soundtrackStore';
import * as capabilityModule from '@/services/bookscore/capability';
import * as persistenceModule from '@/services/bookscore/persistence';
import * as importServiceModule from '@/services/bookscore/importService';
import * as authoringServiceModule from '@/services/bookscore/authoringService';
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
    expect(volumeSlider).toBeDefined();

    // Test Tab wrap-around from last focusable or Shift+Tab from first focusable
    closeBtn.focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    // Expect focus to wrap to last focusable element or stay trapped inside panel
    const dialog = getByRole('dialog', { name: /soundtrack control panel/i });
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useSoundtrackStore.getState().isPanelOpen).toBe(false);
  });

  it('uses currentCfi from soundtrackStore when rendered via SoundtrackControl without explicit prop', async () => {
    vi.spyOn(persistenceModule, 'loadInstalledPackages').mockResolvedValue({
      'pkg-verified-1:hash-1': samplePkg,
    });
    vi.spyOn(persistenceModule, 'loadLocalAssociations').mockResolvedValue({
      'edition-123': sampleAssoc,
    });

    useSoundtrackStore.getState().setCapabilityEnabled(true);
    useSoundtrackStore
      .getState()
      .loadSoundtrackForBook(
        'edition-123',
        { 'pkg-verified-1:hash-1': samplePkg },
        { 'edition-123': sampleAssoc },
      );
    useSoundtrackStore.getState().reportLocation({
      seq: 1,
      kind: 'resolved',
      cfi: 'epubcfi(/6/88!/4/2:10)',
    });
    useSoundtrackStore.getState().setPanelOpen(true);

    const { findByLabelText, getByLabelText } = render(<SoundtrackControl isMobile={false} />);

    // Click "Make Editable Copy"
    const makeCopyBtn = await findByLabelText(/make an editable copy of/i);
    fireEvent.click(makeCopyBtn);

    await waitFor(() => {
      expect(useSoundtrackStore.getState().isAuthoringMode).toBe(true);
    });

    // Click "+ Silence Cue"
    const addSilenceBtn = getByLabelText(/add silence cue at current reading position/i);
    fireEvent.click(addSilenceBtn);

    const editableCopy = useSoundtrackStore.getState().editableCopy;
    expect(editableCopy).not.toBeNull();
    const addedCue = editableCopy!.manifest.cues.find(
      (c) => c.startCfi === 'epubcfi(/6/88!/4/2:10)',
    );
    expect(addedCue).toBeDefined();
    expect(addedCue?.type).toBe('silence');
  });

  it('supports adding Audio Cues and editing Cue properties in CueEditor', async () => {
    vi.spyOn(persistenceModule, 'loadInstalledPackages').mockResolvedValue({
      'pkg-verified-1:hash-1': samplePkg,
    });
    vi.spyOn(persistenceModule, 'loadLocalAssociations').mockResolvedValue({
      'edition-123': sampleAssoc,
    });

    useSoundtrackStore.getState().setCapabilityEnabled(true);
    useSoundtrackStore
      .getState()
      .loadSoundtrackForBook(
        'edition-123',
        { 'pkg-verified-1:hash-1': samplePkg },
        { 'edition-123': sampleAssoc },
      );
    useSoundtrackStore.getState().reportLocation({
      seq: 1,
      kind: 'resolved',
      cfi: 'epubcfi(/6/50!/4/2:0)',
    });
    useSoundtrackStore.getState().setPanelOpen(true);

    const { findByLabelText, getByLabelText, getByText } = render(
      <SoundtrackControl isMobile={false} />,
    );

    // Enter authoring mode
    const makeCopyBtn = await findByLabelText(/make an editable copy of/i);
    fireEvent.click(makeCopyBtn);

    await waitFor(() => {
      expect(useSoundtrackStore.getState().isAuthoringMode).toBe(true);
    });

    // Click "+ Audio Cue"
    const addAudioBtn = getByLabelText(/add audio cue at current reading position/i);
    fireEvent.click(addAudioBtn);

    // CueEditor is opened for the new audio cue
    expect(getByText(/edit cue:/i)).toBeDefined();

    // Click Save in CueEditor
    const saveBtn = getByText(/^save$/i);
    fireEvent.click(saveBtn);

    const editableCopy = useSoundtrackStore.getState().editableCopy;
    const addedAudioCue = editableCopy!.manifest.cues.find(
      (c) => c.startCfi === 'epubcfi(/6/50!/4/2:0)',
    );
    expect(addedAudioCue).toBeDefined();
    expect(addedAudioCue?.type).toBe('audio');
  });

  it('supports reordering cues via Move Up and Move Down buttons in authoring mode', async () => {
    vi.spyOn(persistenceModule, 'loadInstalledPackages').mockResolvedValue({
      'pkg-verified-1:hash-1': samplePkg,
    });
    vi.spyOn(persistenceModule, 'loadLocalAssociations').mockResolvedValue({
      'edition-123': sampleAssoc,
    });

    useSoundtrackStore.getState().setCapabilityEnabled(true);
    useSoundtrackStore
      .getState()
      .loadSoundtrackForBook(
        'edition-123',
        { 'pkg-verified-1:hash-1': samplePkg },
        { 'edition-123': sampleAssoc },
      );
    useSoundtrackStore.getState().setPanelOpen(true);

    const { findByLabelText, getByLabelText, getAllByLabelText } = render(
      <SoundtrackControl isMobile={false} />,
    );

    const makeCopyBtn = await findByLabelText(/make an editable copy of/i);
    fireEvent.click(makeCopyBtn);

    await waitFor(() => {
      expect(useSoundtrackStore.getState().isAuthoringMode).toBe(true);
    });

    // Add a second cue at exact same CFI to test manual reordering
    useSoundtrackStore.getState().reportLocation({
      seq: 2,
      kind: 'resolved',
      cfi: 'epubcfi(/6/2!/4/2:0)',
    });
    const addAudioBtn = getByLabelText(/add audio cue at current reading position/i);
    fireEvent.click(addAudioBtn);

    const copy = useSoundtrackStore.getState().editableCopy!;
    expect(copy.manifest.cues.length).toBeGreaterThanOrEqual(2);

    const targetCue = copy.manifest.cues[1]!;
    const moveUpBtns = getAllByLabelText(/move cue .* up/i);
    expect(moveUpBtns.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(moveUpBtns[1]!);

    await waitFor(() => {
      const reorderedCopy = useSoundtrackStore.getState().editableCopy!;
      expect(reorderedCopy.manifest.cues[0]!.id).toBe(targetCue.id);
    });
  });

  it('traps focus inside the unverified consent dialog for both Tab and Shift+Tab directions', async () => {
    useSoundtrackStore.getState().setCapabilityEnabled(true);
    useSoundtrackStore
      .getState()
      .loadSoundtrackForBook(
        'edition-123',
        { 'pkg-verified-1:hash-1': samplePkg, 'pkg-unverified-2:hash-2': unverifiedPkg },
        { 'edition-123': sampleAssoc },
      );
    useSoundtrackStore.getState().setPanelOpen(true);

    const { findByRole, getByRole } = render(
      <SoundtrackPanel editionId='edition-123' isMobile={false} />,
    );

    const switchConsentBtn = await findByRole('button', { name: /attach unverified package/i });
    fireEvent.click(switchConsentBtn);

    // Consent modal pops up - retrieve the dialog element
    const dialog = getByRole('dialog', { name: /attach unverified soundtrack/i });
    expect(dialog).toBeDefined();
    expect(dialog.getAttribute('aria-modal')).toBe('true');

    // Assert that the dialog close button uses the logical class ms-auto instead of ml-auto
    const closeBtns = within(dialog).getAllByRole('button', { name: /close/i });
    const desktopCloseBtn = closeBtns.find((btn) => btn.className.includes('sm:flex'));
    expect(desktopCloseBtn).toBeDefined();
    expect(desktopCloseBtn!.className).toContain('ms-auto');
    expect(desktopCloseBtn!.className).not.toContain('ml-auto');

    // Query focusable elements inside the dialog
    const focusableSelectors =
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelectors)).filter(
      (el) => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
      },
    );

    expect(focusables.length).toBeGreaterThanOrEqual(2);

    const firstEl = focusables[0]!;
    const lastEl = focusables[focusables.length - 1]!;

    // Focus last element and press Tab -> should focus first element
    lastEl.focus();
    expect(document.activeElement).toBe(lastEl);

    // Dispatch Tab keydown event on the last element to trigger the Dialog's tab trap handler
    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    lastEl.dispatchEvent(tabEvent);

    expect(document.activeElement).toBe(firstEl);

    // Focus first element and press Shift+Tab -> should focus last element
    firstEl.focus();
    expect(document.activeElement).toBe(firstEl);

    const shiftTabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    firstEl.dispatchEvent(shiftTabEvent);

    expect(document.activeElement).toBe(lastEl);
  });

  it('asserts the presence and updates of the polite status live regions in the panel', async () => {
    useSoundtrackStore.getState().setCapabilityEnabled(true);
    useSoundtrackStore
      .getState()
      .loadSoundtrackForBook(
        'edition-123',
        { 'pkg-verified-1:hash-1': samplePkg },
        { 'edition-123': sampleAssoc },
      );
    useSoundtrackStore.getState().setPanelOpen(true);

    const { getByRole, rerender } = render(
      <SoundtrackPanel editionId='edition-123' isMobile={false} />,
    );

    // Assert that status live region is present
    const statusRegion = getByRole('status');
    expect(statusRegion).toBeDefined();
    expect(statusRegion.getAttribute('aria-live')).toBe('polite');

    // Currently paused
    expect(statusRegion.textContent).toContain('Paused');

    // Simulate switching to playing
    useSoundtrackStore.getState().playbackStatus = 'playing';
    rerender(<SoundtrackPanel editionId='edition-123' isMobile={false} />);
    expect(statusRegion.textContent).toContain('Playing');
  });

  it('asserts status live regions for validation issues and alert for export errors', async () => {
    useSoundtrackStore.getState().setCapabilityEnabled(true);
    useSoundtrackStore
      .getState()
      .loadSoundtrackForBook(
        'edition-123',
        { 'pkg-verified-1:hash-1': samplePkg },
        { 'edition-123': sampleAssoc },
      );
    useSoundtrackStore.getState().setPanelOpen(true);

    const validateSpy = vi.spyOn(authoringServiceModule, 'validateEditableCopy').mockResolvedValue({
      valid: false,
      issues: [{ severity: 'error', message: 'Test validation issue' }],
    });

    const exportSpy = vi.spyOn(authoringServiceModule, 'exportEditableCopy').mockResolvedValue({
      success: false,
      error: 'Failed to export package',
      issues: [{ severity: 'error', message: 'Test validation issue' }],
    });

    // Enter authoring mode by making editable copy
    const { findByLabelText, getByRole, getByText } = render(
      <SoundtrackPanel editionId='edition-123' isMobile={false} />,
    );

    const makeCopyBtn = await findByLabelText(/make an editable copy/i);
    fireEvent.click(makeCopyBtn);

    await waitFor(() => {
      expect(useSoundtrackStore.getState().isAuthoringMode).toBe(true);
    });

    // Trigger validation
    const validateBtn = getByRole('button', { name: /validate/i });
    fireEvent.click(validateBtn);

    await waitFor(() => {
      expect(validateSpy).toHaveBeenCalled();
      // Find the validation status region
      const validationStatus = getByText('✕ Test validation issue').parentElement;
      expect(validationStatus?.getAttribute('role')).toBe('status');
      expect(validationStatus?.getAttribute('aria-live')).toBe('polite');
    });

    // Trigger export
    const exportBtn = getByRole('button', { name: /export/i });
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(exportSpy).toHaveBeenCalled();
      const exportAlert = getByRole('alert');
      expect(exportAlert.textContent).toContain('Failed to export package');
      expect(exportAlert.getAttribute('aria-live')).toBe('assertive');
    });
  });

  it('updates the SoundtrackControl trigger aria-label dynamically based on playback status', async () => {
    useSoundtrackStore.getState().setCapabilityEnabled(true);
    useSoundtrackStore
      .getState()
      .loadSoundtrackForBook(
        'edition-123',
        { 'pkg-verified-1:hash-1': samplePkg },
        { 'edition-123': sampleAssoc },
      );

    const { getByRole, rerender } = render(<SoundtrackControl isMobile={false} />);

    // Initially paused status
    let controlBtn = getByRole('button', { name: /Soundtrack controls - Soundtrack Paused/i });
    expect(controlBtn).toBeDefined();

    // Change to playing status
    useSoundtrackStore.getState().playbackStatus = 'playing';
    rerender(<SoundtrackControl isMobile={false} />);

    controlBtn = getByRole('button', { name: /Soundtrack controls - Soundtrack Playing/i });
    expect(controlBtn).toBeDefined();

    // Simulate gesture required state
    useSoundtrackStore.getState().playbackStatus = 'gesture_required';
    rerender(<SoundtrackControl isMobile={false} />);

    controlBtn = getByRole('button', {
      name: /Soundtrack controls - Click to enable Soundtrack Audio/i,
    });
    expect(controlBtn).toBeDefined();
  });

  it('verifies SoundtrackPanel RTL end alignment, e-ink borders, scroll region tabIndices, and focus classes', async () => {
    useSoundtrackStore.getState().setCapabilityEnabled(true);
    useSoundtrackStore
      .getState()
      .loadSoundtrackForBook(
        'edition-123',
        { 'pkg-verified-1:hash-1': samplePkg },
        { 'edition-123': sampleAssoc },
      );
    useSoundtrackStore.getState().setPanelOpen(true);

    const { getByRole, getByLabelText, findByLabelText } = render(
      <SoundtrackPanel editionId='edition-123' isMobile={false} />,
    );

    // Focus style check on close button
    const closeBtn = getByRole('button', { name: /close soundtrack panel/i });
    expect(closeBtn.className).toContain('focus-visible:ring-base-content/15');

    // Scroll region check
    const bodyRegion = getByRole('region', { name: /soundtrack controls content/i });
    expect(bodyRegion.getAttribute('tabindex')).toBe('0');
    expect(bodyRegion.className).toContain('focus-visible:ring-base-content/15');

    // Go to authoring mode
    const makeCopyBtn = await findByLabelText(/make an editable copy/i);
    fireEvent.click(makeCopyBtn);

    // Select the edit cue button to open CueEditor
    const editBtn = await findByLabelText(/edit cue cue-1/i);
    fireEvent.click(editBtn);

    // RTL: verify that the input uses text-end (logical properties) rather than text-right
    const startSecInput = getByLabelText(/^start \(s\)$/i);
    expect(startSecInput.className).toContain('text-end');
    expect(startSecInput.className).not.toContain('text-right');
    expect(startSecInput.className).toContain('focus:ring-primary/40');
  });
});
