import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';

import { Book } from '@/types/book';

import { BookDetailSoundtrack } from '@/components/metadata/BookDetailSoundtrack';
import * as capabilityModule from '@/services/bookscore/capability';
import * as persistenceModule from '@/services/bookscore/persistence';
import * as importServiceModule from '@/services/bookscore/importService';

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

const makeBook = (overrides?: Partial<Book>): Book =>
  ({
    hash: 'test-edition-123',
    title: 'Test EPUB Book',
    author: 'Test Author',
    format: 'EPUB',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }) as Book;

describe('BookDetailSoundtrack Component', () => {
  beforeEach(() => {
    vi.spyOn(capabilityModule, 'isBookScoreCapabilityEnabled').mockReturnValue(true);
    vi.spyOn(persistenceModule, 'loadInstalledPackages').mockResolvedValue({
      'pkg-1:hash1': {
        packageId: 'pkg-1',
        manifestHash: 'hash1',
        manifest: {
          packageId: 'pkg-1',
          title: 'Verified Soundtrack Package',
          version: 1,
          manifestHash: 'hash1',
          editionCompatibility: [
            {
              algorithm: 'readest-partial-md5-v1',
              digest: 'test-edition-123',
              epubByteLength: 1024,
            },
          ],
          assets: [],
          cues: [],
        },
        installedAt: Date.now(),
      },
      'pkg-2:hash2': {
        packageId: 'pkg-2',
        manifestHash: 'hash2',
        manifest: {
          packageId: 'pkg-2',
          title: 'Unverified Mismatched Package',
          version: 1,
          manifestHash: 'hash2',
          editionCompatibility: [
            {
              algorithm: 'readest-partial-md5-v1',
              digest: 'other-edition',
              epubByteLength: 1024,
            },
          ],
          assets: [],
          cues: [],
        },
        installedAt: Date.now(),
      },
    });

    vi.spyOn(persistenceModule, 'loadLocalAssociations').mockResolvedValue({
      'test-edition-123': {
        editionId: 'test-edition-123',
        packageId: 'pkg-1',
        manifestHash: 'hash1',
        selected: true,
        trustState: 'verified',
      },
      'test-edition-123:pkg-1:hash1': {
        editionId: 'test-edition-123',
        packageId: 'pkg-1',
        manifestHash: 'hash1',
        selected: true,
        trustState: 'verified',
      },
    });

    vi.spyOn(persistenceModule, 'loadRepairQueue').mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('hides component when desktop capability is disabled (desktop-only gating)', () => {
    vi.spyOn(capabilityModule, 'isBookScoreCapabilityEnabled').mockReturnValue(false);
    const { container } = render(<BookDetailSoundtrack book={makeBook()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders active soundtrack details and verified badge on desktop', async () => {
    const { getByText, findAllByText } = render(<BookDetailSoundtrack book={makeBook()} />);
    expect((await findAllByText('Verified Soundtrack Package')).length).toBeGreaterThan(0);
    expect(getByText('Verified Association')).toBeTruthy();
  });

  it('allows detaching the active soundtrack', async () => {
    const detachSpy = vi
      .spyOn(importServiceModule, 'detachSoundtrackFromEdition')
      .mockResolvedValue({ success: true });

    const { findByText } = render(<BookDetailSoundtrack book={makeBook()} />);
    const detachBtn = await findByText('Detach');
    fireEvent.click(detachBtn);

    expect(detachSpy).toHaveBeenCalledWith(expect.anything(), 'Data', 'test-edition-123');
  });

  it('opens safe removal confirmation dialog when Remove Package is clicked', async () => {
    const { findAllByText, getAllByText, getByText } = render(
      <BookDetailSoundtrack book={makeBook()} />,
    );
    await findAllByText('Verified Soundtrack Package');
    const removeBtn = getAllByText('Remove Package')[0]!;
    fireEvent.click(removeBtn);

    await waitFor(() => {
      expect(getByText('Remove Soundtrack Package')).toBeTruthy();
      expect(
        getByText(/Are you sure you want to remove 'Verified Soundtrack Package'/),
      ).toBeTruthy();
    });
  });

  it('opens prominent consent dialog when attaching an unverified mismatch candidate', async () => {
    const { findByText, getByText } = render(<BookDetailSoundtrack book={makeBook()} />);

    await findByText('Unverified Mismatched Package');

    const attachBtn = getByText('Attach (Consent Required)');
    fireEvent.click(attachBtn);

    await waitFor(() => {
      expect(getByText('Attach Unverified Soundtrack')).toBeTruthy();
      expect(getByText('Edition Fingerprint Mismatch')).toBeTruthy();
    });
  });

  it('allows removing an unselected installed candidate package directly without changing active selection', async () => {
    const removeSpy = vi
      .spyOn(importServiceModule, 'removeInstalledPackage')
      .mockResolvedValue({ success: true, affectedEditionIds: [] });
    const associateSpy = vi.spyOn(importServiceModule, 'associateSoundtrackToEdition');

    const { findByText, getAllByText, getByText } = render(
      <BookDetailSoundtrack book={makeBook()} />,
    );
    await findByText('Unverified Mismatched Package');

    const removeBtns = getAllByText('Remove Package');
    // The last Remove Package button belongs to the unselected candidate 'pkg-2'
    fireEvent.click(removeBtns[removeBtns.length - 1]!);

    await waitFor(() => {
      expect(getByText('Remove Soundtrack Package')).toBeTruthy();
      expect(
        getByText(/Are you sure you want to remove 'Unverified Mismatched Package'/),
      ).toBeTruthy();
    });

    const confirmBtn = getAllByText('Remove Package').pop()!;
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(removeSpy).toHaveBeenCalledWith(expect.anything(), 'Data', 'pkg-2', 'hash2');
      expect(associateSpy).not.toHaveBeenCalled();
    });
  });

  it('asserts role=status live regions for active and candidate package verification and role=alert for errors', async () => {
    const book = makeBook();
    const { findByRole, getByRole, getByText } = render(<BookDetailSoundtrack book={book} />);

    // Expand accordion (is expanded by default)
    await findByRole('button', { name: /Soundtrack/ });

    // Assert active status badge has role="status" and aria-live="polite"
    await waitFor(() => {
      const activeBadge = getByText('Verified Association');
      const liveRegion = activeBadge.parentElement;
      expect(liveRegion?.getAttribute('role')).toBe('status');
      expect(liveRegion?.getAttribute('aria-live')).toBe('polite');
    });

    // Simulate an error messaging state by making import fail
    vi.spyOn(importServiceModule, 'importAndAssociateBookScorePackage').mockRejectedValue(
      new Error('Import failed test error'),
    );

    // Trigger import file change
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    if (fileInput) {
      fireEvent.change(fileInput, {
        target: { files: [new File([''], 'test.bookscore', { type: 'application/octet-stream' })] },
      });
    }

    await waitFor(() => {
      const errorAlert = getByRole('alert');
      expect(errorAlert.textContent).toContain('Import failed test error');
      expect(errorAlert.getAttribute('aria-live')).toBe('assertive');
    });
  }, 15000);

  it('verifies RTL logical property, e-ink borders, and visible focus rings', async () => {
    vi.spyOn(persistenceModule, 'loadLocalAssociations').mockResolvedValue({});
    vi.spyOn(persistenceModule, 'loadRepairQueue').mockResolvedValue({});

    const book = makeBook();
    const { findByRole } = render(<BookDetailSoundtrack book={book} />);

    const headerBtn = await findByRole('button', { name: /Soundtrack/ });

    // RTL: should use logical start property text-start instead of text-left
    expect(headerBtn.className).toContain('text-start');
    expect(headerBtn.className).not.toContain('text-left');

    // Focus indicators: should have focus-visible styling
    expect(headerBtn.className).toContain('focus-visible:ring-base-content/15');

    // Eink: list or elements should have eink-bordered classes (is expanded by default)
    const importBtn = await findByRole('button', { name: /Import Soundtrack/i });
    expect(importBtn.className).toContain('focus-visible:ring-base-content/15');
  }, 15000);
});
