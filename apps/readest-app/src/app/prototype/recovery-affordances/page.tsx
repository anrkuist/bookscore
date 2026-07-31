'use client';

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  MdChevronLeft,
  MdChevronRight,
  MdMusicOff,
  MdOutlineBuild,
  MdOutlineError,
  MdOutlineLibraryMusic,
} from 'react-icons/md';

// PROTOTYPE — Three recovery-message layouts, switchable via ?variant=.
// This route is deliberately read-only and exists only for issue #10.

const variants = ['A', 'B', 'C'] as const;
type Variant = (typeof variants)[number];

const variantNames: Record<Variant, string> = {
  A: 'Reader banner',
  B: 'Library repair queue',
  C: 'Soundtrack panel row',
};

function ReaderFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className='min-h-screen bg-base-200 p-4 text-base-content sm:p-8'>
      <section className='mx-auto max-w-5xl overflow-hidden rounded-xl border border-base-200 bg-base-100 eink-bordered'>
        <header className='flex items-center justify-between border-b border-base-200 px-5 py-3'>
          <span className='text-sm font-medium'>The Left Hand of Darkness</span>
          <span className='text-sm text-base-content/60'>Chapter 7 · 42%</span>
        </header>
        {children}
      </section>
    </main>
  );
}

function ReadingText() {
  return (
    <div className='max-w-2xl space-y-5 px-6 py-10 text-lg leading-8 text-base-content/85 sm:px-14'>
      <p>
        I was left in the high country with no guide but the wind. The road ahead had disappeared
        beneath snow, yet the silence was enough to make the place feel inhabited.
      </p>
      <p>
        By noon I had learned not to look for a path. It was better to keep the mountain at my
        shoulder and let the daylight settle the question of direction.
      </p>
    </div>
  );
}

function VariantA() {
  return (
    <ReaderFrame>
      <div className='border-b border-base-200 bg-base-200/40 px-5 py-3'>
        <div className='mx-auto flex max-w-2xl items-start gap-3'>
          <MdMusicOff aria-hidden className='mt-0.5 size-5 shrink-0' />
          <div className='min-w-0 flex-1'>
            <p className='font-medium'>Soundtrack is silent</p>
            <p className='mt-0.5 text-sm text-base-content/70'>
              One local audio file can’t be read. Reading continues normally.
            </p>
          </div>
          <button className='btn btn-ghost btn-sm shrink-0'>Review</button>
        </div>
      </div>
      <ReadingText />
    </ReaderFrame>
  );
}

function VariantB() {
  return (
    <main className='min-h-screen bg-base-200 p-4 text-base-content sm:p-8'>
      <section className='mx-auto max-w-4xl rounded-xl border border-base-200 bg-base-100 p-6 eink-bordered sm:p-8'>
        <h1 className='text-lg font-semibold tracking-tight'>Soundtrack repairs</h1>
        <p className='mt-1 text-sm leading-relaxed text-base-content/70'>
          Fix local soundtrack files without interrupting your reading.
        </p>
        <div className='mt-6 rounded-lg border border-base-200 bg-base-100 eink-bordered'>
          <div className='flex gap-3 border-b border-base-200 p-4'>
            <MdOutlineBuild aria-hidden className='mt-0.5 size-5 shrink-0' />
            <div className='min-w-0 flex-1'>
              <p className='font-medium'>The Left Hand of Darkness</p>
              <p className='mt-1 text-sm text-base-content/70'>
                “Across the Ice” is missing from the local package. Its cue now plays silence.
              </p>
              <p className='mt-2 text-xs font-medium uppercase tracking-wide text-base-content/60'>
                Installed soundtrack · needs repair
              </p>
            </div>
          </div>
          <div className='flex flex-wrap items-center justify-between gap-3 p-3'>
            <span className='text-sm text-base-content/70'>
              Your reading position and other cues are safe.
            </span>
            <div className='flex gap-2'>
              <button className='btn btn-ghost btn-sm'>Remove soundtrack</button>
              <button className='btn btn-contrast btn-sm'>Re-import package</button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function VariantC() {
  return (
    <ReaderFrame>
      <div className='grid min-h-[32rem] grid-cols-1 sm:grid-cols-[1fr_19rem]'>
        <ReadingText />
        <aside className='border-t border-base-200 bg-base-200/40 p-5 sm:border-s sm:border-t-0'>
          <div className='flex items-center gap-2'>
            <MdOutlineLibraryMusic aria-hidden className='size-5' />
            <h1 className='font-semibold'>Soundtrack</h1>
          </div>
          <p className='mt-1 text-sm text-base-content/70'>Northern passage · paused</p>
          <div className='mt-5 rounded-lg border border-base-200 bg-base-100 p-4 eink-bordered'>
            <div className='flex items-start gap-2'>
              <MdOutlineError aria-hidden className='mt-0.5 size-5 shrink-0' />
              <div>
                <p className='text-sm font-medium'>This cue is playing silence</p>
                <p className='mt-1 text-sm leading-relaxed text-base-content/70'>
                  Its audio file isn’t available on this device.
                </p>
              </div>
            </div>
            <button className='btn btn-ghost btn-sm mt-3 w-full'>Repair soundtrack…</button>
          </div>
          <button className='btn btn-contrast btn-sm mt-5 w-full'>Play soundtrack</button>
        </aside>
      </div>
    </ReaderFrame>
  );
}

function PrototypeSwitcher({ variant }: { variant: Variant }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const select = (next: Variant) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('variant', next);
    router.replace(`${pathname}?${params.toString()}`);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, [contenteditable]')) return;
      const offset = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
      if (!offset) return;
      event.preventDefault();
      select(variants[(variants.indexOf(variant) + offset + variants.length) % variants.length]!);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const previous = variants[(variants.indexOf(variant) - 1 + variants.length) % variants.length]!;
  const next = variants[(variants.indexOf(variant) + 1) % variants.length]!;
  return (
    <nav
      className='fixed inset-x-0 bottom-5 z-10 mx-auto flex w-fit items-center gap-2 rounded-full bg-base-content px-2 py-2 text-base-100 shadow-lg'
      aria-label='Prototype variation'
    >
      <button
        className='btn btn-ghost btn-circle btn-sm text-base-100'
        onClick={() => select(previous)}
        aria-label='Previous variation'
      >
        <MdChevronLeft className='size-5' />
      </button>
      <span className='min-w-40 text-center text-sm font-medium'>
        {variant} — {variantNames[variant]}
      </span>
      <button
        className='btn btn-ghost btn-circle btn-sm text-base-100'
        onClick={() => select(next)}
        aria-label='Next variation'
      >
        <MdChevronRight className='size-5' />
      </button>
    </nav>
  );
}

export default function RecoveryAffordancesPrototypePage() {
  const searchParams = useSearchParams();
  const candidate = searchParams?.get('variant');
  const variant: Variant = variants.includes(candidate as Variant) ? (candidate as Variant) : 'A';

  return (
    <>
      {variant === 'A' && <VariantA />}
      {variant === 'B' && <VariantB />}
      {variant === 'C' && <VariantC />}
      {process.env.NODE_ENV !== 'production' && <PrototypeSwitcher variant={variant} />}
    </>
  );
}
