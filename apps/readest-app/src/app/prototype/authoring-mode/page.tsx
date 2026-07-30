'use client';

import { useMemo, useState } from 'react';

type Cue = {
  id: string;
  title: string;
  asset: string;
  location: string;
  kind: 'audio' | 'silence';
};

const initialCues: Cue[] = [
  { id: 'prologue', title: 'Prologue', asset: 'Rain.mp3', location: '0%', kind: 'audio' },
  {
    id: 'greenhouse',
    title: 'The greenhouse',
    asset: 'Garden.mp3',
    location: '18%',
    kind: 'audio',
  },
  { id: 'midnight', title: 'After midnight', asset: 'Silence', location: '42%', kind: 'silence' },
];

const Button = ({
  children,
  onClick,
  primary = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  primary?: boolean;
}) => (
  <button
    className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-base-content/20 ${
      primary
        ? 'border-base-content bg-base-content text-base-100'
        : 'border-base-300 bg-base-100 hover:bg-base-200'
    }`}
    onClick={onClick}
    type='button'
  >
    {children}
  </button>
);

export default function AuthoringModePrototypePage() {
  const [isAuthoring, setIsAuthoring] = useState(false);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [isAssetViewOpen, setIsAssetViewOpen] = useState(false);
  const [isValid, setIsValid] = useState<boolean | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [cueKind, setCueKind] = useState<'audio' | 'silence'>('audio');
  const [cues, setCues] = useState(initialCues);
  const [selectedCueId, setSelectedCueId] = useState('greenhouse');

  const selectedCue = useMemo(
    () => cues.find((cue) => cue.id === selectedCueId) ?? initialCues[0]!,
    [cues, selectedCueId],
  );

  const addScene = () => {
    const nextCue: Cue = {
      id: `scene-${cues.length + 1}`,
      title: 'New scene',
      asset: cueKind === 'silence' ? 'Silence' : 'Garden.mp3',
      location: 'current',
      kind: cueKind,
    };
    setCues((current) => [...current, nextCue]);
    setSelectedCueId(nextCue.id);
    setIsComposerOpen(false);
    setIsValid(null);
  };

  return (
    <main className='min-h-screen bg-base-200 p-4 text-base-content sm:p-8'>
      <div className='mx-auto max-w-6xl'>
        <header className='mb-6 max-w-2xl'>
          <p className='text-sm font-medium text-base-content/65'>PROTOTYPE — NOT PRODUCTION UI</p>
          <h1 className='mt-1 text-2xl font-semibold tracking-tight'>BookScore Authoring Mode</h1>
          <p className='mt-2 text-sm leading-relaxed text-base-content/70'>
            A reference interaction: the book is the timeline, and soundtrack editing stays a
            compact sidebar rather than becoming a digital-audio workstation.
          </p>
        </header>

        <section className='grid overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-sm md:grid-cols-[minmax(0,1fr)_22rem]'>
          <article className='min-h-[38rem] p-8 sm:p-12'>
            <div className='mb-16 flex items-center justify-between text-sm text-base-content/65'>
              <span>← Library</span>
              <span>🔖 &nbsp; 🔊 &nbsp; ⚙</span>
            </div>
            <p className='text-sm font-medium text-base-content/60'>CHAPTER 4</p>
            <h2 className='mt-2 text-3xl font-semibold tracking-tight'>The Greenhouse</h2>
            <p className='mt-10 max-w-xl text-lg leading-9 text-base-content/80'>
              Mary pushed through the old wooden door. The scent of wet earth gathered around her,
              quiet and green, while the garden seemed to hold its breath.
            </p>
            <p className='mt-6 max-w-xl text-lg leading-9 text-base-content/80'>
              Something moved beyond the ivy. She took another step into the warm, shadowed room.
            </p>
          </article>

          <aside className='border-t border-base-300 bg-base-200/40 md:border-s md:border-t-0'>
            <div className='border-b border-base-300 p-4'>
              <div className='flex items-start justify-between gap-3'>
                <div>
                  <p className='text-xs font-medium tracking-wide text-base-content/60'>
                    SOUNDTRACK
                  </p>
                  <h2 className='mt-1 font-semibold'>Midnight in the Garden</h2>
                  <p className='text-sm text-base-content/65'>
                    {isAuthoring ? 'Editable copy' : 'Installed package'}
                  </p>
                </div>
                <button
                  className='rounded-full p-2 hover:bg-base-300'
                  type='button'
                  aria-label='More actions'
                >
                  ···
                </button>
              </div>
            </div>

            {!isAuthoring ? (
              <div className='space-y-5 p-4'>
                <div>
                  <p className='text-sm text-base-content/65'>Now playing</p>
                  <p className='mt-1 font-medium'>{selectedCue.title}</p>
                  <p className='text-sm text-base-content/65'>{selectedCue.asset}</p>
                </div>
                <input
                  className='w-full accent-base-content'
                  type='range'
                  defaultValue='72'
                  aria-label='Volume'
                />
                <Button primary onClick={() => setIsPlaying((value) => !value)}>
                  {isPlaying ? '❚❚ Pause' : '▶ Play'}
                </Button>
                <CueList cues={cues} selectedCueId={selectedCueId} onSelect={setSelectedCueId} />
                <div className='flex flex-wrap gap-2'>
                  <Button onClick={() => setIsAuthoring(true)}>Make editable copy</Button>
                  <Button>Import</Button>
                </div>
              </div>
            ) : (
              <div className='space-y-5 p-4'>
                <div className='flex items-center justify-between gap-2'>
                  <Button onClick={() => setIsAuthoring(false)}>← Reading</Button>
                  <span className='text-xs text-base-content/60'>changes saved locally</span>
                </div>
                <label className='block text-sm font-medium'>
                  Soundtrack name
                  <input
                    className='mt-1 w-full rounded-lg border border-base-300 bg-base-100 px-3 py-2 font-normal'
                    defaultValue='Midnight in the Garden'
                  />
                </label>
                <div className='flex items-center justify-between'>
                  <h3 className='text-sm font-semibold'>Scene cues</h3>
                  <button
                    className='text-sm font-medium underline underline-offset-4'
                    onClick={() => setIsComposerOpen(true)}
                    type='button'
                  >
                    + At this position
                  </button>
                </div>
                <CueList cues={cues} selectedCueId={selectedCueId} onSelect={setSelectedCueId} />
                <div className='grid grid-cols-2 gap-2'>
                  <Button onClick={() => setIsAssetViewOpen(true)}>Assets</Button>
                  <Button onClick={() => setIsPlaying((value) => !value)}>
                    {isPlaying ? 'Stop preview' : 'Preview cue'}
                  </Button>
                  <Button onClick={() => setIsValid(true)}>Validate</Button>
                  <Button primary>Export</Button>
                </div>
                {isValid !== null && (
                  <p className='rounded-lg border border-base-300 bg-base-100 p-3 text-sm'>
                    ✓ Ready to export: 3 assets and {cues.length} ordered cues are valid.
                  </p>
                )}
              </div>
            )}
          </aside>
        </section>
      </div>

      {isComposerOpen && (
        <Dialog title='Add scene at this position' onClose={() => setIsComposerOpen(false)}>
          <p className='text-sm text-base-content/70'>
            <strong>Chapter 4 — The Greenhouse</strong> · current reading position
          </p>
          <fieldset className='mt-5 space-y-3 text-sm'>
            <legend className='font-medium'>This scene plays</legend>
            <label className='flex items-center gap-2'>
              <input
                checked={cueKind === 'audio'}
                onChange={() => setCueKind('audio')}
                type='radio'
                name='kind'
              />
              Garden.mp3
            </label>
            <label className='flex items-center gap-2'>
              <input
                checked={cueKind === 'silence'}
                onChange={() => setCueKind('silence')}
                type='radio'
                name='kind'
              />
              Intentional silence
            </label>
          </fieldset>
          {cueKind === 'audio' && (
            <div className='mt-5 grid grid-cols-2 gap-3 text-sm'>
              <label>
                Start
                <input
                  className='mt-1 w-full rounded border border-base-300 p-2'
                  defaultValue='00:00'
                />
              </label>
              <label>
                Crossfade
                <input
                  className='mt-1 w-full rounded border border-base-300 p-2'
                  defaultValue='700 ms'
                />
              </label>
            </div>
          )}
          <div className='mt-6 flex justify-end gap-2'>
            <Button onClick={() => setIsComposerOpen(false)}>Cancel</Button>
            <Button onClick={() => setIsPlaying(true)}>Preview</Button>
            <Button primary onClick={addScene}>
              Add scene
            </Button>
          </div>
        </Dialog>
      )}

      {isAssetViewOpen && (
        <Dialog title='Audio assets' onClose={() => setIsAssetViewOpen(false)}>
          <ul className='divide-y divide-base-300 rounded-lg border border-base-300'>
            {['Rain.mp3 · 03:42', 'Garden.mp3 · 04:10', 'Night insects.mp3 · 02:33'].map(
              (asset) => (
                <li className='flex justify-between p-3 text-sm' key={asset}>
                  <span>{asset}</span>
                  <button className='underline'>Remove</button>
                </li>
              ),
            )}
          </ul>
          <div className='mt-5'>
            <Button>Add MP3</Button>
          </div>
        </Dialog>
      )}
    </main>
  );
}

function CueList({
  cues,
  selectedCueId,
  onSelect,
}: {
  cues: Cue[];
  selectedCueId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <ol className='space-y-1'>
      {cues.map((cue) => (
        <li key={cue.id}>
          <button
            className={`w-full rounded-lg border p-3 text-start text-sm ${selectedCueId === cue.id ? 'border-base-content bg-base-100' : 'border-transparent hover:bg-base-300/60'}`}
            onClick={() => onSelect(cue.id)}
            type='button'
          >
            <span className='block font-medium'>
              {cue.title}
              {selectedCueId === cue.id ? ' · current' : ''}
            </span>
            <span className='block text-base-content/65'>
              {cue.location} · {cue.asset}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className='fixed inset-0 z-50 grid place-items-center bg-black/35 p-4'>
      <section
        aria-modal='true'
        role='dialog'
        className='w-full max-w-lg rounded-xl border border-base-300 bg-base-100 p-6 shadow-xl'
      >
        <div className='flex items-start justify-between gap-4'>
          <h2 className='text-lg font-semibold tracking-tight'>{title}</h2>
          <button
            className='rounded-full px-2 py-1 hover:bg-base-200'
            onClick={onClose}
            type='button'
            aria-label='Close'
          >
            ×
          </button>
        </div>
        <div className='mt-4'>{children}</div>
      </section>
    </div>
  );
}
