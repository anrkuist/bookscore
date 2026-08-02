import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import {
  MdCheckCircle,
  MdExpandLess,
  MdExpandMore,
  MdOutlineFileUpload,
  MdWarning,
} from 'react-icons/md';

import { Book } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { isBookScoreCapabilityEnabled } from '@/services/bookscore/capability';
import {
  associateSoundtrackToEdition,
  computeSoundtrackCandidates,
  detachSoundtrackFromEdition,
  getAffectedAssociationsForPackage,
  importAndAssociateBookScorePackage,
  isEditionCompatibleWithManifest,
  removeInstalledPackage,
} from '@/services/bookscore/importService';
import {
  loadInstalledPackages,
  loadLocalAssociations,
  loadRepairQueue,
  StoredAssociationsMap,
  StoredPackagesMap,
} from '@/services/bookscore/persistence';
import {
  InstalledPackage,
  SoundtrackCandidate,
  StoredRepairQueueMap,
} from '@/services/bookscore/types';

import { FileSystem } from '@/types/system';
import Dialog from '../Dialog';

interface BookDetailSoundtrackProps {
  book: Book;
}

export const BookDetailSoundtrack: React.FC<BookDetailSoundtrackProps> = ({ book }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [packages, setPackages] = useState<StoredPackagesMap>({});
  const [associations, setAssociations] = useState<StoredAssociationsMap>({});
  const [repairQueue, setRepairQueue] = useState<StoredRepairQueueMap>({});
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Modal states
  const [consentTarget, setConsentTarget] = useState<InstalledPackage | null>(null);
  const [verifiedTarget, setVerifiedTarget] = useState<InstalledPackage | null>(null);
  const [removalTarget, setRemovalTarget] = useState<InstalledPackage | null>(null);

  const isEnabled = isBookScoreCapabilityEnabled({ isMobile: appService?.isMobile });
  const editionId = book.hash;

  const refreshData = async () => {
    if (!appService) return;
    try {
      const fs = appService as unknown as FileSystem;
      const pkgs = await loadInstalledPackages(fs, 'Data');
      const assocs = await loadLocalAssociations(fs, 'Data');
      const queue = await loadRepairQueue(fs, 'Data');
      setPackages(pkgs);
      setAssociations(assocs);
      setRepairQueue(queue);
    } catch (err) {
      console.warn('Failed to load soundtrack packages/associations:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isEnabled) {
      refreshData();
    }
  }, [book.hash, isEnabled]);

  if (!isEnabled) {
    return null;
  }

  const { activeAssociation, candidates } = computeSoundtrackCandidates(
    editionId,
    packages,
    associations,
  );

  const activePackage = activeAssociation
    ? (packages[`${activeAssociation.packageId}:${activeAssociation.manifestHash}`] ??
      packages[activeAssociation.packageId])
    : null;

  const handleSelectPackage = async (cand: SoundtrackCandidate) => {
    if (!appService) return;
    setErrorMsg(null);

    if (cand.trustState === 'unverified') {
      setConsentTarget(cand.package);
      return;
    }

    const fs = appService as unknown as FileSystem;
    const res = await associateSoundtrackToEdition(
      fs,
      'Data',
      editionId,
      cand.package.packageId,
      cand.package.manifestHash,
    );

    if (res.success) {
      await refreshData();
    } else if (res.error) {
      setErrorMsg(res.error);
    }
  };

  const handleConfirmUnverifiedConsent = async () => {
    if (!consentTarget || !appService) return;
    const fs = appService as unknown as FileSystem;
    const pkg = consentTarget;
    setConsentTarget(null);

    const res = await associateSoundtrackToEdition(
      fs,
      'Data',
      editionId,
      pkg.packageId,
      pkg.manifestHash,
      { consentGiven: true },
    );

    if (res.success) {
      await refreshData();
    } else if (res.error) {
      setErrorMsg(res.error);
    }
  };

  const handleConfirmVerifiedCandidate = async () => {
    if (!verifiedTarget || !appService) return;
    const fs = appService as unknown as FileSystem;
    const pkg = verifiedTarget;
    setVerifiedTarget(null);

    const res = await associateSoundtrackToEdition(
      fs,
      'Data',
      editionId,
      pkg.packageId,
      pkg.manifestHash,
    );

    if (res.success) {
      await refreshData();
    } else if (res.error) {
      setErrorMsg(res.error);
    }
  };

  const handleDetachActive = async () => {
    if (!appService) return;
    setErrorMsg(null);
    const fs = appService as unknown as FileSystem;
    const res = await detachSoundtrackFromEdition(fs, 'Data', editionId);
    if (res.success) {
      await refreshData();
    }
  };

  const handleConfirmRemoval = async () => {
    if (!removalTarget || !appService) return;
    const fs = appService as unknown as FileSystem;
    const pkg = removalTarget;
    setRemovalTarget(null);
    setErrorMsg(null);

    const res = await removeInstalledPackage(fs, 'Data', pkg.packageId, pkg.manifestHash);
    if (res.success) {
      await refreshData();
    }
  };

  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !appService) return;

    setImporting(true);
    setErrorMsg(null);

    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const fs = appService as unknown as FileSystem;

      // Import package without auto-attaching
      const res = await importAndAssociateBookScorePackage(
        fs,
        'Data',
        bytes,
        editionId,
        undefined,
        { autoAttach: false },
      );

      if (!res.success || !res.package) {
        setErrorMsg(res.error || _('Failed to import soundtrack package.'));
        return;
      }

      await refreshData();

      // Offer candidate based on fingerprint match
      const importedPkg = res.package;
      const isMatch = isEditionCompatibleWithManifest(importedPkg.manifest, editionId);

      if (isMatch) {
        setVerifiedTarget(importedPkg);
      } else {
        setConsentTarget(importedPkg);
      }
    } catch (err) {
      setErrorMsg(`Import failed: ${err}`);
    } finally {
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const affectedAssociations = removalTarget
    ? getAffectedAssociationsForPackage(
        removalTarget.packageId,
        removalTarget.manifestHash,
        associations,
      )
    : [];

  return (
    <div className='metadata-soundtrack text-base-content my-2'>
      <button
        className={clsx(
          'flex w-full items-center justify-between px-4 py-3 text-left transition-colors',
          isCollapsed ? 'hover:bg-base-200 rounded-lg' : '',
        )}
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <span className='text-neutral-content/85 text-base font-semibold'>{_('Soundtrack')}</span>
        <div className='transition-transform duration-200'>
          {isCollapsed ? (
            <MdExpandMore className='h-5 w-5' />
          ) : (
            <MdExpandLess className='h-5 w-5' />
          )}
        </div>
      </button>

      {!isCollapsed && (
        <div className='px-4 py-2 space-y-3'>
          {errorMsg && (
            <div className='alert alert-error text-xs p-2 rounded-lg flex items-center justify-between'>
              <span>{errorMsg}</span>
              <button className='btn btn-ghost btn-xs' onClick={() => setErrorMsg(null)}>
                ✕
              </button>
            </div>
          )}

          {loading ? (
            <p className='text-sm text-neutral-content animate-pulse'>
              {_('Loading soundtrack details...')}
            </p>
          ) : (
            <>
              {/* Active Soundtrack Info */}
              {activeAssociation && activePackage ? (
                (() => {
                  const activeRepairItem =
                    repairQueue[`${activePackage.packageId}:${activePackage.manifestHash}`] ??
                    repairQueue[activePackage.packageId];
                  return (
                    <div className='p-3 rounded-lg border border-base-300 bg-base-200/50 space-y-2 eink-bordered'>
                      <div className='flex items-center justify-between flex-wrap gap-2'>
                        <div>
                          <p className='text-sm font-bold'>{activePackage.manifest.title}</p>
                          <p className='text-xs text-neutral-content'>
                            {_('Version')} {activePackage.manifest.version}
                          </p>
                        </div>
                        {activeRepairItem ? (
                          <span
                            className='badge badge-error gap-1 text-xs py-1 px-2 font-medium text-white'
                            title={_('Package failure: {reason}', {
                              reason: activeRepairItem.reason,
                            })}
                          >
                            <MdWarning className='h-3 w-3' />
                            {_('Repair Required ({reason})', { reason: activeRepairItem.reason })}
                          </span>
                        ) : activeAssociation.trustState === 'unverified' ? (
                          <span
                            className='badge badge-warning gap-1 text-xs py-1 px-2 font-medium'
                            title={_(
                              'EPUB edition fingerprint mismatch. Consent granted for local association.',
                            )}
                          >
                            <MdWarning className='h-3 w-3' />
                            {_('Unverified Association')}
                          </span>
                        ) : (
                          <span
                            className='badge badge-success gap-1 text-xs py-1 px-2 font-medium text-white'
                            title={_('EPUB edition fingerprint match verified.')}
                          >
                            <MdCheckCircle className='h-3 w-3' />
                            {_('Verified Association')}
                          </span>
                        )}
                      </div>

                      {activeRepairItem && (
                        <p className='text-xs text-warning leading-relaxed font-medium'>
                          {_(
                            'Audio files are missing, unreadable, or corrupted. Re-import the package to repair.',
                          )}
                        </p>
                      )}

                      <div className='flex items-center gap-2 pt-1 flex-wrap'>
                        {activeRepairItem && (
                          <button
                            className='btn btn-xs btn-contrast gap-1'
                            onClick={() => fileInputRef.current?.click()}
                          >
                            <MdOutlineFileUpload className='h-3.5 w-3.5' />
                            {_('Repair (Re-import)')}
                          </button>
                        )}
                        <button
                          className='btn btn-xs btn-ghost border border-base-300'
                          onClick={handleDetachActive}
                        >
                          {_('Detach')}
                        </button>
                        <button
                          className='btn btn-xs btn-outline btn-error'
                          onClick={() => setRemovalTarget(activePackage)}
                        >
                          {_('Remove Package')}
                        </button>
                      </div>
                    </div>
                  );
                })()
              ) : (
                <p className='text-sm text-neutral-content italic'>
                  {_('No soundtrack currently attached to this edition.')}
                </p>
              )}

              {/* Candidate List */}
              {candidates.length > 0 && (
                <div className='space-y-2 pt-2'>
                  <p className='text-xs font-bold text-neutral-content/90 uppercase tracking-wider'>
                    {_('Installed Soundtrack Packages')}
                  </p>
                  <div className='space-y-2 max-h-48 overflow-y-auto pe-1'>
                    {candidates.map((cand) => {
                      const candRepairItem =
                        repairQueue[`${cand.package.packageId}:${cand.package.manifestHash}`] ??
                        repairQueue[cand.package.packageId];
                      return (
                        <div
                          key={`${cand.package.packageId}:${cand.package.manifestHash}`}
                          className={clsx(
                            'p-2.5 rounded-lg border text-sm flex items-center justify-between gap-2',
                            cand.isSelected
                              ? 'border-primary bg-primary/5'
                              : 'border-base-300 bg-base-100',
                            'eink-bordered',
                          )}
                        >
                          <div className='min-w-0 flex-1'>
                            <div className='flex items-center gap-2 flex-wrap'>
                              <span className='font-semibold line-clamp-1'>
                                {cand.package.manifest.title}
                              </span>
                              {candRepairItem ? (
                                <span className='badge badge-xs badge-error text-white me-1'>
                                  {_('Repair Required')}
                                </span>
                              ) : cand.trustState === 'verified' ? (
                                <span className='badge badge-xs badge-success text-white'>
                                  {_('Verified')}
                                </span>
                              ) : (
                                <span className='badge badge-xs badge-warning'>
                                  {_('Unverified')}
                                </span>
                              )}
                            </div>
                            <p className='text-xs text-neutral-content'>
                              v{cand.package.manifest.version}
                            </p>
                          </div>
                          <div className='flex items-center gap-2 flex-wrap justify-end'>
                            {cand.isSelected ? (
                              <span className='text-xs font-semibold text-primary px-2 py-1 bg-primary/10 rounded'>
                                {_('Active')}
                              </span>
                            ) : (
                              <button
                                className={clsx(
                                  'btn btn-xs',
                                  cand.trustState === 'verified'
                                    ? 'btn-contrast'
                                    : 'btn-outline btn-warning',
                                )}
                                onClick={() => handleSelectPackage(cand)}
                              >
                                {cand.trustState === 'verified'
                                  ? _('Attach')
                                  : _('Attach (Consent Required)')}
                              </button>
                            )}
                            <button
                              className='btn btn-xs btn-outline btn-error'
                              onClick={() => setRemovalTarget(cand.package)}
                            >
                              {_('Remove Package')}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Import Button */}
              <div className='pt-2 flex items-center gap-2'>
                <input
                  type='file'
                  ref={fileInputRef}
                  accept='.bookscore,.zip'
                  className='hidden'
                  onChange={handleImportFileChange}
                />
                <button
                  className='btn btn-sm btn-contrast gap-2'
                  disabled={importing}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <MdOutlineFileUpload className='h-4 w-4' />
                  {importing ? _('Importing...') : _('Import Soundtrack (.bookscore)')}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Prominent Consent Modal */}
      {consentTarget && (
        <Dialog
          isOpen={Boolean(consentTarget)}
          title={_('Attach Unverified Soundtrack')}
          onClose={() => setConsentTarget(null)}
          boxClassName='sm:max-w-[440px] sm:h-auto'
        >
          <div className='p-4 space-y-4 text-sm select-text'>
            <div className='flex items-start gap-3 text-warning'>
              <MdWarning className='h-6 w-6 shrink-0 mt-0.5' />
              <div>
                <p className='font-bold text-base-content'>{_('Edition Fingerprint Mismatch')}</p>
                <p className='text-xs text-neutral-content mt-1'>
                  {_(
                    "This soundtrack package ('{title}') was created for a different EPUB edition fingerprint.",
                    {
                      title: consentTarget.manifest.title,
                    },
                  )}
                </p>
              </div>
            </div>

            <p className='text-xs leading-relaxed text-neutral-content'>
              {_(
                'Audio timing or CFI paragraph alignment issues may occur when attached to a mismatched edition. Do you want to proceed and persist a local-only unverified association for this edition?',
              )}
            </p>

            <div className='flex justify-end gap-2 pt-2'>
              <button className='btn btn-sm btn-ghost' onClick={() => setConsentTarget(null)}>
                {_('Cancel')}
              </button>
              <button className='btn btn-sm btn-contrast' onClick={handleConfirmUnverifiedConsent}>
                {_('Attach as Unverified')}
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Verified Candidate Offer Modal */}
      {verifiedTarget && (
        <Dialog
          isOpen={Boolean(verifiedTarget)}
          title={_('Verified Soundtrack Found')}
          onClose={() => setVerifiedTarget(null)}
          boxClassName='sm:max-w-[440px] sm:h-auto'
        >
          <div className='p-4 space-y-4 text-sm select-text'>
            <div className='flex items-start gap-3 text-success'>
              <MdCheckCircle className='h-6 w-6 shrink-0 mt-0.5' />
              <div>
                <p className='font-bold text-base-content'>{_('Verified Soundtrack Candidate')}</p>
                <p className='text-xs text-neutral-content mt-1'>
                  {_(
                    "A matching soundtrack package ('{title}') was imported and verified for this edition fingerprint.",
                    {
                      title: verifiedTarget.manifest.title,
                    },
                  )}
                </p>
              </div>
            </div>

            <p className='text-xs leading-relaxed text-neutral-content'>
              {_(
                'Would you like to attach this soundtrack to this book as the active soundtrack now?',
              )}
            </p>

            <div className='flex justify-end gap-2 pt-2'>
              <button className='btn btn-sm btn-ghost' onClick={() => setVerifiedTarget(null)}>
                {_('Skip')}
              </button>
              <button className='btn btn-sm btn-contrast' onClick={handleConfirmVerifiedCandidate}>
                {_('Attach Soundtrack')}
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Safe Removal Confirmation Modal */}
      {removalTarget && (
        <Dialog
          isOpen={Boolean(removalTarget)}
          title={_('Remove Soundtrack Package')}
          onClose={() => setRemovalTarget(null)}
          boxClassName='sm:max-w-[460px] sm:h-auto'
        >
          <div className='p-4 space-y-4 text-sm select-text'>
            <p className='font-bold text-base-content'>
              {_("Are you sure you want to remove '{title}' (v{version}) from device storage?", {
                title: removalTarget.manifest.title,
                version: removalTarget.manifest.version,
              })}
            </p>

            {affectedAssociations.length > 0 ? (
              <div className='space-y-1.5 bg-base-200/60 p-3 rounded-lg border border-base-300 text-xs eink-bordered'>
                <p className='font-semibold text-neutral-content/90'>
                  {_('Affected Local Associations ({count}):', {
                    count: affectedAssociations.length,
                  })}
                </p>
                <ul className='list-disc list-inside space-y-1 text-neutral-content font-mono text-[11px]'>
                  {affectedAssociations.map((aff) => (
                    <li key={aff.editionId}>
                      {aff.editionId === editionId
                        ? _('This book ({id})', { id: aff.editionId })
                        : aff.editionId}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className='text-xs text-neutral-content'>
                {_('No books currently have this soundtrack package active.')}
              </p>
            )}

            <p className='text-xs text-error font-medium'>
              {_(
                'This package will be detached from all affected books and its audio files deleted. It will not switch to another soundtrack automatically.',
              )}
            </p>

            <div className='flex justify-end gap-2 pt-2'>
              <button className='btn btn-sm btn-ghost' onClick={() => setRemovalTarget(null)}>
                {_('Cancel')}
              </button>
              <button className='btn btn-sm btn-error' onClick={handleConfirmRemoval}>
                {_('Remove Package')}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
};
