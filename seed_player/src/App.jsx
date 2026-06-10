import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import OvercookScene from './components/OvercookScene.jsx';

const FRAME_DURATION = 0.45;

// Index all map JSON files via Vite glob
const mapModules = import.meta.glob('./maps/*/**/*.json');

function buildMapTree(modules) {
  // Returns: { [layout]: { [level]: [{ path, filename, load }] } }
  const tree = {};
  for (const [path, load] of Object.entries(modules)) {
    // path like: ./maps/2_forced_hard/L1/filename.json
    const parts = path.replace('./maps/', '').split('/');
    if (parts.length < 3) continue;
    const layout = parts[0];
    const level = parts[1];
    const filename = parts.slice(2).join('/');
    if (!tree[layout]) tree[layout] = {};
    if (!tree[layout][level]) tree[layout][level] = [];
    tree[layout][level].push({ path, filename, load, layout, level });
  }
  // Sort levels naturally
  for (const layout of Object.keys(tree)) {
    const sorted = {};
    Object.keys(tree[layout]).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).forEach(k => {
      sorted[k] = tree[layout][k].sort((a, b) => a.filename.localeCompare(b.filename));
    });
    tree[layout] = sorted;
  }
  return tree;
}

// ─── Playback Hook (RAF-based) ──────────────────────────────────
function usePlayback(data, playbackRate = 1, externalControl = null) {
  const [frameIndex, setFrameIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const rafRef = useRef(null);
  const elapsedRef = useRef(0);

  const totalFrames = data ? data.dynamicState.length : 0;
  const totalTime = totalFrames * FRAME_DURATION;

  useEffect(() => { elapsedRef.current = elapsed; }, [elapsed]);

  // External sync control
  useEffect(() => {
    if (!externalControl || !data) return;
    if (externalControl.action === 'play') {
      if (elapsedRef.current >= totalTime - FRAME_DURATION) {
        setFrameIndex(0); setElapsed(0); elapsedRef.current = 0;
      }
      setIsPlaying(true);
    } else if (externalControl.action === 'pause') {
      cancelAnimationFrame(rafRef.current);
      setIsPlaying(false);
    } else if (externalControl.action === 'reset') {
      cancelAnimationFrame(rafRef.current);
      setFrameIndex(0); setElapsed(0); elapsedRef.current = 0;
      setIsPlaying(false);
    }
  }, [externalControl]);

  const togglePlay = useCallback(() => {
    if (!data || totalFrames === 0) return;
    if (isPlaying) { cancelAnimationFrame(rafRef.current); setIsPlaying(false); return; }
    if (elapsedRef.current >= totalTime - FRAME_DURATION) {
      setFrameIndex(0); setElapsed(0); elapsedRef.current = 0;
    }
    setIsPlaying(true);
  }, [data, totalFrames, isPlaying, totalTime]);

  const seek = useCallback((idx) => {
    const c = Math.max(0, Math.min(idx, totalFrames - 1));
    setFrameIndex(c); setElapsed(c * FRAME_DURATION); elapsedRef.current = c * FRAME_DURATION;
    cancelAnimationFrame(rafRef.current); setIsPlaying(false);
  }, [totalFrames]);

  const stepForward = useCallback(() => {
    if (frameIndex < totalFrames - 1) { const n = frameIndex + 1; setFrameIndex(n); setElapsed(n * FRAME_DURATION); elapsedRef.current = n * FRAME_DURATION; cancelAnimationFrame(rafRef.current); setIsPlaying(false); }
  }, [frameIndex, totalFrames]);

  const stepBackward = useCallback(() => {
    if (frameIndex > 0) { const p = frameIndex - 1; setFrameIndex(p); setElapsed(p * FRAME_DURATION); elapsedRef.current = p * FRAME_DURATION; cancelAnimationFrame(rafRef.current); setIsPlaying(false); }
  }, [frameIndex]);

  const jumpToStart = useCallback(() => {
    setFrameIndex(0); setElapsed(0); elapsedRef.current = 0; cancelAnimationFrame(rafRef.current); setIsPlaying(false);
  }, []);

  const jumpToEnd = useCallback(() => {
    const last = Math.max(0, totalFrames - 1);
    setFrameIndex(last); setElapsed(last * FRAME_DURATION); elapsedRef.current = last * FRAME_DURATION; cancelAnimationFrame(rafRef.current); setIsPlaying(false);
  }, [totalFrames]);

  // RAF loop
  useEffect(() => {
    if (!isPlaying || !data || totalFrames === 0) { cancelAnimationFrame(rafRef.current); return; }
    const startTime = performance.now() - (elapsedRef.current * 1000) / playbackRate;
    const update = () => {
      const now = performance.now();
      const newElapsed = ((now - startTime) / 1000) * playbackRate;
      const newIdx = Math.floor(newElapsed / FRAME_DURATION);
      if (newIdx < totalFrames) {
        setFrameIndex(newIdx); setElapsed(newElapsed); elapsedRef.current = newElapsed;
        rafRef.current = requestAnimationFrame(update);
      } else {
        setFrameIndex(totalFrames - 1); setElapsed(totalTime); elapsedRef.current = totalTime; setIsPlaying(false);
      }
    };
    rafRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, data, playbackRate, totalFrames, totalTime]);

  return { frameIndex, elapsed, isPlaying, totalFrames, totalTime, togglePlay, seek, stepForward, stepBackward, jumpToStart, jumpToEnd };
}

// ─── Seed Browser Modal ─────────────────────────────────────────
function SeedBrowser({ mapTree, onSelect, onClose }) {
  const [currentLayout, setCurrentLayout] = useState(null);
  const [currentLevel, setCurrentLevel] = useState(null);
  const [loading, setLoading] = useState(false);

  const layouts = Object.keys(mapTree).sort();

  const handleSelectFile = async (entry) => {
    setLoading(true);
    try {
      const module = await entry.load();
      const rawData = module.default ?? module;
      onSelect(rawData, entry.filename, entry.layout, entry.level);
    } catch (err) {
      console.error('Failed to load seed:', err);
      alert('Failed to load seed file.');
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    if (currentLevel) setCurrentLevel(null);
    else if (currentLayout) setCurrentLayout(null);
  };

  let title = 'Select Layout';
  if (currentLayout && currentLevel) title = `${currentLayout} / ${currentLevel}`;
  else if (currentLayout) title = currentLayout;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="seed-browser" onClick={(e) => e.stopPropagation()}>
        <div className="browser-header">
          <h3>{loading ? 'Loading...' : 'Browse Seeds'}</h3>
          <button className="browser-close" onClick={onClose}>×</button>
        </div>

        {/* Breadcrumb */}
        <div className="browser-breadcrumb">
          <span className={currentLayout ? 'breadcrumb-part' : 'breadcrumb-current'}
            onClick={() => { setCurrentLayout(null); setCurrentLevel(null); }}>
            maps
          </span>
          {currentLayout && (
            <>
              <span className="breadcrumb-sep">/</span>
              <span className={currentLevel ? 'breadcrumb-part' : 'breadcrumb-current'}
                onClick={() => setCurrentLevel(null)}>
                {currentLayout}
              </span>
            </>
          )}
          {currentLevel && (
            <>
              <span className="breadcrumb-sep">/</span>
              <span className="breadcrumb-current">{currentLevel}</span>
            </>
          )}
        </div>

        {/* File List */}
        <div className="browser-list">
          {!currentLayout && layouts.map(layout => (
            <div key={layout} className="browser-item" onClick={() => setCurrentLayout(layout)}>
              <span className="icon">📁</span>
              <span className="name">{layout}</span>
              <span className="chevron">›</span>
            </div>
          ))}

          {currentLayout && !currentLevel && Object.keys(mapTree[currentLayout]).map(level => (
            <div key={level} className="browser-item" onClick={() => setCurrentLevel(level)}>
              <span className="icon">📁</span>
              <span className="name">{level}</span>
              <span className="chevron">›</span>
            </div>
          ))}

          {currentLayout && currentLevel && mapTree[currentLayout][currentLevel]?.map(entry => (
            <div key={entry.path} className="browser-item file" onClick={() => handleSelectFile(entry)}>
              <span className="icon" style={{ color: '#888' }}>{ }</span>
              <span className="name">{entry.filename}</span>
            </div>
          ))}

          {/* Back button when navigated */}
          {(currentLayout || currentLevel) && (
            <div className="browser-item" onClick={goBack} style={{ color: '#888', borderTop: '1px solid #1a1a1a', marginTop: 4, paddingTop: 10 }}>
              <span className="icon">←</span>
              <span className="name">Back</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── PlayerPanel ───────────────────────────────────────────────
function PlayerPanel({ data, filename, layout, level, playbackRate, onClose, panelId, externalControl }) {
  const pb = usePlayback(data, playbackRate, externalControl);
  const [copied, setCopied] = useState(false);

  if (!data) return null;

  const frame = data.dynamicState[pb.frameIndex];
  const score = frame?.score ?? 0;

  const handleCopy = () => {
    if (!filename) return;
    navigator.clipboard.writeText(filename);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="player-panel">
      <div className="panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
          <span className="panel-label">{panelId}</span>
          {layout && <span className="tag">{layout}</span>}
          {level && <span className="tag level">{level}</span>}
        </div>
        <div className="panel-info">
          <span>Score: <span className="score-display">{score}</span></span>
          {onClose && <button className="panel-close-btn" onClick={onClose}>×</button>}
        </div>
      </div>

      <div className="scene-container">
        <OvercookScene staticInfo={data.staticInfo} frame={frame} frames={data.dynamicState} frameIndex={pb.frameIndex} elapsed={pb.elapsed} frameDuration={FRAME_DURATION} />
      </div>

      <div className="transport-bar">
        <input type="range" className="transport-slider" min={0} max={pb.totalFrames > 0 ? pb.totalFrames - 1 : 0} value={pb.frameIndex} onChange={(e) => pb.seek(Number(e.target.value))} />
        <div className="transport-row">
          <div className="transport-left">
            <span>{pb.frameIndex} / {pb.totalFrames > 0 ? pb.totalFrames - 1 : 0}</span>
          </div>
          <div className="transport-center">
            <button className="ctrl-btn muted" onClick={pb.jumpToStart}>⏮</button>
            <button className="ctrl-btn" onClick={pb.stepBackward}>◀</button>
            <button className="ctrl-btn play" onClick={pb.togglePlay}>{pb.isPlaying ? '⏸' : '▶'}</button>
            <button className="ctrl-btn" onClick={pb.stepForward}>▶</button>
            <button className="ctrl-btn muted" onClick={pb.jumpToEnd}>⏭</button>
          </div>
          <div className="transport-right" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="filename-tag" title={filename}>{filename}</span>
            <button 
              onClick={handleCopy}
              style={{ background: 'transparent', border: 'none', color: copied ? '#22c55e' : '#666', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', outline: 'none' }}
              title="Copy filename"
            >
              {copied ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main App ───────────────────────────────────────────────────
const SLOT_LABELS = ['Seed A', 'Seed B', 'Seed C', 'Seed D'];

export default function App() {
  const mapTree = useMemo(() => buildMapTree(mapModules), []);

  // 4 slots
  const [slots, setSlots] = useState([null, null, null, null]);
  const [browserSlot, setBrowserSlot] = useState(null); // which slot is browsing
  const [playbackRate, setPlaybackRate] = useState(1);
  const [syncControl, setSyncControl] = useState(null); // { action, ts }

  const loadedCount = slots.filter(Boolean).length;

  const handleSelectSeed = (slotIndex, data, filename, layout, level) => {
    setSlots(prev => {
      const next = [...prev];
      next[slotIndex] = { data, filename, layout, level };
      return next;
    });
    setBrowserSlot(null);
  };

  const handleRemoveSlot = (slotIndex) => {
    setSlots(prev => {
      const next = [...prev];
      next[slotIndex] = null;
      return next;
    });
  };

  const handleSyncPlay = () => {
    setSyncControl({ action: 'play', ts: Date.now() });
  };

  const handleSyncPause = () => {
    setSyncControl({ action: 'pause', ts: Date.now() });
  };

  const handleSyncReset = () => {
    setSyncControl({ action: 'reset', ts: Date.now() });
  };

  // Keyboard
  useEffect(() => {
    const handleKeyDown = (e) => { if (e.code === 'Space') e.preventDefault(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Determine what slots to render in the grid
  const renderSlots = [];
  if (loadedCount === 0) {
    renderSlots.push({ index: 0, empty: true });
    renderSlots.push({ index: 1, empty: true });
  } else if (loadedCount === 1) {
    const loadedIdx = slots.findIndex(s => s);
    const emptyIdx = loadedIdx === 0 ? 1 : 0;
    renderSlots.push({ index: loadedIdx, slot: slots[loadedIdx] });
    renderSlots.push({ index: emptyIdx, empty: true });
    renderSlots.sort((a,b) => a.index - b.index);
  } else {
    slots.forEach((slot, i) => {
      if (slot) renderSlots.push({ index: i, slot });
    });
  }

  // Determine grid cols
  const getGridClass = () => {
    const count = renderSlots.length;
    if (count <= 1) return 'cols-1';
    if (count === 2) return 'cols-2';
    if (count === 3) return 'cols-3';
    return 'cols-4';
  };

  // Empty slots to show as add buttons
  const emptySlotIndices = slots.map((slot, i) => slot ? null : i).filter(i => i !== null);

  return (
    <div className="app">
      {/* Top bar: sync controls + speed */}
      <div className="top-bar">
        <div className="top-bar-right" style={{ gap: 6 }}>
          {loadedCount >= 1 && (
            <>
              <button className="ctrl-btn muted" onClick={handleSyncReset} title="Reset all">⏮</button>
              <button className="ctrl-btn play" onClick={handleSyncPlay} title="Play all">▶</button>
              <button className="ctrl-btn" onClick={handleSyncPause} title="Pause all">⏸</button>
              <button
                onClick={handleSyncReset}
                style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#aaa', fontSize: 12, fontWeight: 600, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Reset All
              </button>
              <span style={{ width: 1, height: 16, background: '#333', margin: '0 4px' }} />
            </>
          )}
          <span className="speed-label">Speed</span>
          <select className="speed-select" value={playbackRate} onChange={(e) => setPlaybackRate(Number(e.target.value))}>
            <option value={0.5}>0.5x</option>
            <option value={1}>1.0x</option>
            <option value={1.5}>1.5x</option>
            <option value={2}>2.0x</option>
          </select>
          {/* Add seed button */}
          {emptySlotIndices.length > 0 && (
            <>
              <span style={{ width: 1, height: 16, background: '#333', margin: '0 4px' }} />
              <button
                onClick={() => setBrowserSlot(emptySlotIndices[0])}
                style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#aaa', fontSize: 12, fontWeight: 600, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                + Add Seed
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className={`main-content ${getGridClass()}`}>
        {renderSlots.map(slot => {
          if (slot.empty) {
            return (
              <div 
                key={`empty-${slot.index}`}
                className="player-panel" 
                onClick={() => setBrowserSlot(slot.index)} 
                style={{ alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: '#0a0a0c', transition: 'background 0.2s' }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = '#111';
                  const btn = e.currentTarget.querySelector('.placeholder-btn');
                  if (btn) {
                    btn.style.borderColor = '#fcd34d';
                    btn.style.color = '#fff';
                    btn.style.background = 'rgba(252, 211, 77, 0.04)';
                  }
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = '#0a0a0c';
                  const btn = e.currentTarget.querySelector('.placeholder-btn');
                  if (btn) {
                    btn.style.borderColor = '#444';
                    btn.style.color = '#ccc';
                    btn.style.background = 'rgba(255,255,255,0.02)';
                  }
                }}
              >
                <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#666', letterSpacing: 1.5, textTransform: 'uppercase' }}>
                    {SLOT_LABELS[slot.index]}
                  </div>
                  <div 
                    className="placeholder-btn"
                    style={{ 
                      padding: '12px 24px', 
                      border: '1px dashed #444', 
                      borderRadius: '8px', 
                      fontSize: '14px', 
                      color: '#ccc', 
                      fontWeight: 600,
                      background: 'rgba(255,255,255,0.02)',
                      transition: 'all 0.2s',
                    }}
                  >
                    + Click to Select Seed
                  </div>
                </div>
              </div>
            );
          }

          return (
            <PlayerPanel
              key={slot.index}
              data={slot.slot.data}
              filename={slot.slot.filename}
              layout={slot.slot.layout}
              level={slot.slot.level}
              playbackRate={playbackRate}
              onClose={() => handleRemoveSlot(slot.index)}
              panelId={SLOT_LABELS[slot.index]}
              externalControl={syncControl}
            />
          );
        })}
      </div>

      {/* Seed Browser Modal */}
      {browserSlot !== null && (
        <SeedBrowser
          mapTree={mapTree}
          onSelect={(data, filename, layout, level) => handleSelectSeed(browserSlot, data, filename, layout, level)}
          onClose={() => setBrowserSlot(null)}
        />
      )}
    </div>
  );
}
