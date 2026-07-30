'use client';

import { useState } from 'react';

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

export default function SoundtrackPlaybackPrototypePage() {
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isTtsActive, setIsTtsActive] = useState(false);
  const [volume, setVolume] = useState(70);
  const [status, setStatus] = useState('Reopened paused at Chapter 4.');

  const togglePlayback = () => {
    if (isTtsActive) return;
    const nextPlaying = !isPlaying;
    setIsPlaying(nextPlaying);
    setHasPlayed(true);
    setStatus(nextPlaying ? 'Playback started by reader gesture.' : 'Playback paused.');
  };

  const toggleTts = () => {
    const nextTtsActive = !isTtsActive;
    setIsTtsActive(nextTtsActive);
    setIsPlaying(false);
    setStatus(
      nextTtsActive
        ? 'Soundtrack paused for text-to-speech.'
        : 'Text-to-speech stopped; soundtrack remains paused.',
    );
  };

  return (
    <main className='min-h-screen bg-base-200 p-4 text-base-content sm:p-8'>
      <div className='mx-auto max-w-6xl'>
        <header className='mb-6 max-w-2xl'>
          <p className='text-sm font-medium text-base-content/65'>PROTOTYPE — NOT PRODUCTION UI</p>
          <h1 className='mt-1 text-2xl font-semibold tracking-tight'>Soundtrack Playback</h1>
          <p className='mt-2 text-sm leading-relaxed text-base-content/70'>
            Reading mode keeps soundtrack details behind one quiet header control. Open the panel to
            explore consent, cues, trust, and TTS arbitration.
          </p>
        </header>

        <section
          className={`grid overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-sm ${isPanelOpen ? 'md:grid-cols-[minmax(0,1fr)_22rem]' : ''}`}
        >
          <article className='min-h-[38rem] p-8 sm:p-12'>
            <div className='mb-16 flex items-center justify-between text-sm text-base-content/65'>
              <span>← Library</span>
              <div className='flex items-center gap-2'>
                <button
                  className='rounded-full px-2 py-1 hover:bg-base-200'
                  onClick={() => setIsPanelOpen((value) => !value)}
                  type='button'
                >
                  {isPlaying ? '♬ playing' : '♬ paused'}
                </button>
                <button
                  className={`rounded-full px-2 py-1 hover:bg-base-200 ${isTtsActive ? 'bg-base-300' : ''}`}
                  onClick={toggleTts}
                  type='button'
                >
                  {isTtsActive ? 'TTS on' : 'TTS'}
                </button>
                <span>🔖 &nbsp; ⚙</span>
              </div>
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
            {isTtsActive && (
              <p className='mt-8 max-w-xl rounded-lg border border-base-300 bg-base-200/60 p-3 text-sm'>
                Soundtrack paused for Text-to-Speech. It will stay paused when TTS stops.
              </p>
            )}
          </article>

          {isPanelOpen && (
            <aside className='border-t border-base-300 bg-base-200/40 md:border-s md:border-t-0'>
              <div className='border-b border-base-300 p-4'>
                <div className='flex items-start justify-between gap-3'>
                  <div>
                    <p className='text-xs font-medium tracking-wide text-base-content/60'>
                      SOUNDTRACK
                    </p>
                    <h2 className='mt-1 font-semibold'>Soundtrack</h2>
                  </div>
                  <button
                    className='rounded-full px-2 py-1 hover:bg-base-300'
                    onClick={() => setIsPanelOpen(false)}
                    type='button'
                    aria-label='Close soundtrack panel'
                  >
                    ×
                  </button>
                </div>
              </div>

              <div className='space-y-5 p-4'>
                {!hasPlayed && (
                  <div className='rounded-lg border border-base-300 bg-base-100 p-3 text-sm'>
                    <p className='font-medium'>Ready to play</p>
                    <p className='mt-1 text-base-content/65'>
                      This soundtrack is stored on this device and starts only when you ask.
                    </p>
                  </div>
                )}
                <div>
                  <p className='text-sm text-base-content/65'>Now playing</p>
                  <p className='mt-1 font-medium'>Rain at Dusk</p>
                  <p className='text-sm text-base-content/65'>Scene 4 · 18%</p>
                </div>
                <Button primary onClick={togglePlayback}>
                  {isPlaying ? '❚❚ Pause' : '▶ Play soundtrack'}
                </Button>
                <label className='block text-sm'>
                  Volume <span className='text-base-content/65'>{volume}%</span>
                  <input
                    className='mt-2 w-full accent-base-content'
                    type='range'
                    value={volume}
                    onChange={(event) => setVolume(Number(event.target.value))}
                  />
                </label>
                <p className='rounded-lg border border-base-300 bg-base-100 p-3 text-sm'>
                  {status}
                </p>
              </div>
            </aside>
          )}
        </section>
      </div>
    </main>
  );
}
