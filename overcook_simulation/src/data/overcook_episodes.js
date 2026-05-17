// src/data/overcook_episodes.js

// 업로드된 trajectory 포맷을 viewer 포맷으로 통일
// 지원 포맷
// 1) { staticInfo, dynamicState: [...] }
// 2) { staticInfo, frames: [...] }
const MAX_PLAYBACK_FRAMES = 100;

export function adaptEpisode(raw, fileName = "unknown") {
  const staticInfo = raw.staticInfo;

  const rawFrames =
    Array.isArray(raw.dynamicState) && raw.dynamicState.length > 0
      ? raw.dynamicState
      : Array.isArray(raw.frames)
      ? raw.frames
      : [];

  if (!staticInfo || rawFrames.length === 0) {
    console.warn(
      `[overcook_episodes] Unexpected format in ${fileName}. ` +
        "Expected { staticInfo, dynamicState[] } or { staticInfo, frames[] }."
    );
  }

  // generate_realtime_state_json now matches the viewer's x/y convention.
  // Keep coordinates as-is and only normalize the surrounding shape.
  const frames = rawFrames.slice(0, MAX_PLAYBACK_FRAMES).map((state) => ({
    ...state,
    players: (state.players || []).map((p) => ({
      ...p,
      position: p.position,
      heldObject: p.heldObject,
    })),
    objects: (state.objects || []).map((o) => ({
      ...o,
      position: o.position,
    })),
  }));

  return {
    staticInfo,
    frames,
  };
}
