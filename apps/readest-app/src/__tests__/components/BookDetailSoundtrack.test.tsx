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
    const { getAllByText, getByText, findByText } = render(
      <BookDetailSoundtrack book={makeBook()} />,
    );
    expect(await findByText('Soundtrack')).toBeTruthy();
    expect(getAllByText('Verified Soundtrack Package').length).toBeGreaterThan(0);
    expect(getByText('Verified Association')).toBeTruthy();
  });

  it('allows detaching the active soundtrack', async () => {
    const detachSpy = vi
      .spyOn(importServiceModule, 'detachSoundtrackFromEdition')
      .mockResolvedValue({ success: true });

    const { findByText, getByText } = render(<BookDetailSoundtrack book={makeBook()} />);
    await findByText('Soundtrack');

    const detachBtn = getByText('Detach');
    fireEvent.click(detachBtn);

    expect(detachSpy).toHaveBeenCalledWith(expect.anything(), 'Data', 'test-edition-123');
  });

  it('opens safe removal confirmation dialog when Remove Package is clicked', async () => {
    const { findByText, getAllByText, getByText } = render(
      <BookDetailSoundtrack book={makeBook()} />,
    );
    await findByText('Soundtrack');

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
});
