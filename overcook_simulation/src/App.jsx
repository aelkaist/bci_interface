// src/App.jsx

import React, { useState, useEffect, useRef } from "react";
import OvercookScene from "./components/OvercookScene";
import { adaptEpisode } from "./data/overcook_episodes";
import { Range } from "react-range";
import { saveFeedbackToFirestore } from "./firebase";

import random3Seed5 from "./maps/random3_5_7520000.json";
import smallCorridorSeed5 from "./maps/small_corridor_5_7520000.json";
import random0MediumSeed5 from "./maps/random0_medium_5_7520000.json";
import multiplayerSchelling3Seed5 from "./maps/multiplayer_schelling_3_5_7520000.json";
import multiplayerSchellingSeed5 from "./maps/multiplayer_schelling_5_7520000.json";

const ALL_MAPS = [
  { name: "random3_5_7520000.json", data: random3Seed5 },
  { name: "small_corridor_5_7520000.json", data: smallCorridorSeed5 },
  { name: "random0_medium_5_7520000.json", data: random0MediumSeed5 },
  { name: "multiplayer_schelling_3_5_7520000.json", data: multiplayerSchelling3Seed5 },
  { name: "multiplayer_schelling_5_7520000.json", data: multiplayerSchellingSeed5 }
];

const MIN_OFFSET = -20;
const MAX_OFFSET = 20;
const FRAME_DURATION = 0.3;

// 시간 라벨 (필요하면 사용)
function baseTimeLabel(frame) {
  return `${(frame * FRAME_DURATION).toFixed(2)}s`;
}

export default function App() {
  const [instructionStep, setInstructionStep] = useState(-1);
  const [prolificId, setProlificId] = useState("");
  const [hasReadInstructions, setHasReadInstructions] = useState(false);
  const [testSliderValue, setTestSliderValue] = useState([0]);

  // Quiz states
  const [quiz1Answer, setQuiz1Answer] = useState(null);
  const [quiz2Matches, setQuiz2Matches] = useState({});
  const [quiz2Words] = useState(() => {
    let words = ["Onion", "Pot", "Dish", "AI Chef", "Serving Area"];
    for (let i = words.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [words[i], words[j]] = [words[j], words[i]];
    }
    return words;
  });
  const [quiz3Order, setQuiz3Order] = useState([3, 1, 4, 2]);

  const [episode, setEpisode] = useState(null); // 현재 에피소드
  const [fileName, setFileName] = useState(""); // 현재 맵 이름
  const [isSaving, setIsSaving] = useState(false); // DB 저장 상태
  const fileInputRef = useRef(null);

  const [mapOrder, setMapOrder] = useState([]);
  const [currentMapIdx, setCurrentMapIdx] = useState(0);

  useEffect(() => {
    let indices = Array.from({ length: ALL_MAPS.length }, (_, index) => index);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    setMapOrder(indices);
  }, []);

  const loadMapByIndex = (index) => {
    const mapObj = ALL_MAPS[index];
    if (!mapObj) return;

    try {
      const adapted = adaptEpisode(mapObj.data, mapObj.name);

      cancelAnimationFrame(rafRef.current);

      setEpisode({
        fileName: mapObj.name,
        ...adapted,
      });
      setFileName(mapObj.name);

      setIsPlaying(false);
      setPlayMode("full");
      segmentEndFrameRef.current = null;

      setElapsed(0);
      setFrameIndex(0);
      setRawMarkers([]);
      setIntervals([]);
      setSelectedInterval(null);

      sessionStartRef.current = Date.now();
      pauseCountRef.current = 0;
      playbackSpeedChangesRef.current = [];
      setPlaybackRate(1);

    } catch (err) {
      console.error("Failed to parse map", err);
    }
  };

  // 전체화면 토글 함수
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.warn(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  const [frameIndex, setFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  const [playMode, setPlayMode] = useState("full"); // "full" | "segment"
  const [elapsed, setElapsed] = useState(0); // 초 단위 경과 시간
  const [playbackRate, setPlaybackRate] = useState(1); // 재생 배속

  const [rawMarkers, setRawMarkers] = useState([]); // [frameIndex, ...]
  const [intervals, setIntervals] = useState([]); // [{ baseFrame, startOffset, endOffset, reason }, ...]
  const [selectedInterval, setSelectedInterval] = useState(null);

  const [episodeCount, setEpisodeCount] = useState(1); // 현재 에피소드 진행 상황

  const panelWidth = 720; // 우측 패널 너비 고정

  const rafRef = useRef(null);
  const segmentEndFrameRef = useRef(null); // 구간 재생 끝 프레임
  const bottomDockRef = useRef(null);

  const scrollContainerRef = useRef(null);
  const prevIntervalsLen = useRef(0);

  const sessionStartRef = useRef(Date.now());
  const pauseCountRef = useRef(0);
  const playbackSpeedChangesRef = useRef([]);
  const elapsedRef = useRef(0);
  const [bottomDockHeight, setBottomDockHeight] = useState(0);

  useEffect(() => {
    if (intervals.length > prevIntervalsLen.current) {
      setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTo({
            top: scrollContainerRef.current.scrollHeight,
            behavior: "smooth"
          });
        }
      }, 100);
    }
    prevIntervalsLen.current = intervals.length;
  }, [intervals.length]);

  useEffect(() => {
    elapsedRef.current = elapsed;
  }, [elapsed]);

  useEffect(() => {
    const dock = bottomDockRef.current;
    if (!dock) return;

    const updateDockHeight = () => {
      setBottomDockHeight(dock.getBoundingClientRect().height);
    };

    updateDockHeight();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateDockHeight);
      return () => window.removeEventListener("resize", updateDockHeight);
    }

    const observer = new ResizeObserver(() => {
      updateDockHeight();
    });

    observer.observe(dock);
    return () => observer.disconnect();
  }, []);

  const frameDuration = FRAME_DURATION;
  const totalFrames = episode?.frames?.length ?? 0;
  const totalTime = totalFrames * frameDuration;
  const hasEpisode = totalFrames > 0;

  const frame =
    hasEpisode && totalFrames > 0
      ? episode.frames[Math.min(frameIndex, totalFrames - 1)]
      : null;
  const progress =
    hasEpisode && totalTime > 0
      ? Math.min((elapsed / totalTime) * 100, 100)
      : 0;

  // 구간 재생 여부
  const isReplaying = playMode === "segment" && isPlaying;

  // JSON 파일 업로드 핸들러
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const raw = JSON.parse(event.target.result);
        const adapted = adaptEpisode(raw, file.name);

        // 기존 재생 취소
        cancelAnimationFrame(rafRef.current);

        // 새 에피소드로 상태 리셋
        setEpisode({
          fileName: file.name,
          ...adapted,
        });
        setFileName(file.name);

        setIsPlaying(false);
        setPlayMode("full");
        segmentEndFrameRef.current = null;

        if (hasEpisode) {
          setEpisodeCount((c) => Math.min(c + 1, ALL_MAPS.length));
        }

        setElapsed(0);
        setFrameIndex(0);
        setRawMarkers([]);
        setIntervals([]);
        setSelectedInterval(null);

        sessionStartRef.current = Date.now();
        pauseCountRef.current = 0;
        playbackSpeedChangesRef.current = [];
        setPlaybackRate(1);

      } catch (err) {
        console.error("Failed to read JSON", err);
        alert("유효한 JSON 파일이 아닙니다.");
      }
    };
    reader.readAsText(file);
  };

  // 메인 재생 루프
  useEffect(() => {
    if (!isPlaying || !episode || totalFrames === 0) {
      cancelAnimationFrame(rafRef.current);
      return;
    }

    const startTime = performance.now() - (elapsedRef.current * 1000) / playbackRate;

    const update = () => {
      const now = performance.now();
      const newElapsed = ((now - startTime) / 1000) * playbackRate;
      const newFrameIndex = Math.floor(newElapsed / frameDuration);

      // 구간 재생 모드
      if (playMode === "segment") {
        const endFrame = segmentEndFrameRef.current ?? totalFrames - 1;

        if (newFrameIndex >= endFrame) {
          setFrameIndex(endFrame);
          setElapsed(endFrame * frameDuration);
          setIsPlaying(false);
          return;
        }

        setFrameIndex(newFrameIndex);
        setElapsed(newElapsed);
        rafRef.current = requestAnimationFrame(update);
        return;
      }

      // 전체 재생 모드
      if (newFrameIndex < totalFrames) {
        setFrameIndex(newFrameIndex);
        setElapsed(newElapsed);
        rafRef.current = requestAnimationFrame(update);
      } else {
        setFrameIndex(totalFrames - 1);
        setElapsed(totalTime);
        setIsPlaying(false);

      }
    };

    rafRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, playMode, frameDuration, totalFrames, totalTime, episode, playbackRate]);

  // Space key → Play/Pause, M key → 현재 프레임 마커 추가
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = e.target.tagName?.toLowerCase?.() || "";
      const isTyping =
        tag === "textarea" ||
        tag === "input" ||
        e.target.isContentEditable;

      if (isTyping) return;

      if (e.code === "Space") {
        e.preventDefault();

        if (!episode || totalFrames === 0) return;

        if (isPlaying) {
          cancelAnimationFrame(rafRef.current);
          setIsPlaying(false);
          pauseCountRef.current += 1;
        } else {
          let targetFrame = frameIndex;
          let targetElapsed = elapsed;
          if (frameIndex >= totalFrames - 1) {
            targetFrame = 0;
            targetElapsed = 0;
            setFrameIndex(0);
            setElapsed(0);
          }
          cancelAnimationFrame(rafRef.current);
          setPlayMode("full");

          setIsPlaying(true);
        }
      } else if (e.code === "KeyM") {
        e.preventDefault();
        if (!episode || totalFrames === 0) return;

        setRawMarkers((prev) => {
          if (prev.includes(frameIndex)) return prev;
          return [...prev, frameIndex];
        });

        setIntervals((prev) => {
          if (prev.some((intv) => intv.baseFrame === frameIndex)) return prev;
          return [
            ...prev,
            {
              baseFrame: frameIndex,
              startOffset: -2,
              endOffset: 2,
              reason: "",
              isFullRange: false,
              createdAt: Date.now(),
              lastModifiedAt: Date.now(),
            },
          ];
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [frameIndex, isPlaying, episode, totalFrames, playMode, elapsed]);

  // 선택한 interval만 재생
  const handleReplayFromBase = (intv) => {
    if (!intv || !episode || totalFrames === 0) return;

    let startFrame = intv.isFullRange ? intv.baseFrame : intv.baseFrame + intv.startOffset;
    let endFrame = intv.isFullRange ? intv.baseFrame : intv.baseFrame + intv.endOffset;

    startFrame = Math.max(startFrame, 0);
    endFrame = Math.min(endFrame, totalFrames - 1);

    if (startFrame > endFrame) {
      const tmp = startFrame;
      startFrame = endFrame;
      endFrame = tmp;
    }

    const startTime = startFrame * frameDuration;

    cancelAnimationFrame(rafRef.current);
    setIsPlaying(false);

    segmentEndFrameRef.current = endFrame;
    setPlayMode("segment");

    requestAnimationFrame(() => {
      setFrameIndex(startFrame);
      setElapsed(startTime);
      setIsPlaying(true);
    });
  };

  const togglePlay = () => {
    if (!episode || totalFrames === 0) return;

    if (isPlaying) {
      cancelAnimationFrame(rafRef.current);
      setIsPlaying(false);
      pauseCountRef.current += 1;
      return;
    }

    if (frameIndex >= totalFrames - 1) {
      setFrameIndex(0);
      setElapsed(0);
    }

    cancelAnimationFrame(rafRef.current);
    setPlayMode("full");

    setIsPlaying(true);
  };

  const handleAddMarker = () => {
    if (!episode || totalFrames === 0) return;
    setRawMarkers((prev) => {
      if (prev.includes(frameIndex)) return prev;
      return [...prev, frameIndex];
    });
    setIntervals((prev) => {
      if (prev.some((intv) => intv.baseFrame === frameIndex)) return prev;
      return [
        ...prev,
        {
          baseFrame: frameIndex,
          startOffset: -2,
          endOffset: 2,
          reason: "",
          isFullRange: false,
          createdAt: Date.now(),
          lastModifiedAt: Date.now(),
        },
      ];
    });
  };

  // 같은 trajectory에서 완전 초기화
  const reset = () => {
    cancelAnimationFrame(rafRef.current);

    setIsPlaying(false);
    setPlayMode("full");
    segmentEndFrameRef.current = null;

    setElapsed(0);
    setFrameIndex(0);
    setRawMarkers([]);
    setIntervals([]);
    setSelectedInterval(null);

  };

  // 오프셋 편집
  const handleOffsetEdit = (field, value) => {
    if (!selectedInterval) return;

    const intValue = parseInt(value, 10);
    if (Number.isNaN(intValue)) return;

    const updated = [...intervals];
    updated[selectedInterval.index][field] = intValue;
    updated[selectedInterval.index].lastModifiedAt = Date.now();
    setIntervals(updated);

    setSelectedInterval((prev) => ({
      ...prev,
      [field]: intValue,
    }));
  };

  // reason 편집
  const handleReasonChange = (value) => {
    if (!selectedInterval) return;

    const updated = [...intervals];
    updated[selectedInterval.index].reason = value;
    updated[selectedInterval.index].lastModifiedAt = Date.now();
    setIntervals(updated);

    setSelectedInterval((prev) => ({
      ...prev,
      reason: value,
    }));
  };

  // correction 편집
  const handleCorrectionChange = (value) => {
    if (!selectedInterval) return;

    const updated = [...intervals];
    updated[selectedInterval.index].correction = value;
    updated[selectedInterval.index].lastModifiedAt = Date.now();
    setIntervals(updated);

    setSelectedInterval((prev) => ({
      ...prev,
      correction: value,
    }));
  };

  const deleteInterval = (index) => {
    setIntervals((prev) => prev.filter((_, i) => i !== index));
    setRawMarkers((prev) => prev.filter((_, i) => i !== index));
    setSelectedInterval(null);
  };

  // JSON export helper
  const exportJSON = (data, filename) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const generatePayload = () => {
    if (!episode || totalFrames === 0) return null;

    const sessionDurationSec = Math.round((Date.now() - sessionStartRef.current) / 1000);

    const feedbackDetails = intervals.map((intv) => {
      const baseFrame = intv.baseFrame;
      let startFrame = intv.isFullRange ? baseFrame : baseFrame + intv.startOffset;
      let endFrame = intv.isFullRange ? baseFrame : baseFrame + intv.endOffset;

      startFrame = Math.max(0, Math.min(startFrame, totalFrames - 1));
      endFrame = Math.max(0, Math.min(endFrame, totalFrames - 1));

      if (startFrame > endFrame) {
        const tmp = startFrame;
        startFrame = endFrame;
        endFrame = tmp;
      }

      const isDidSpecify = !intv.isFullRange;
      return {
        startFrame: isDidSpecify ? startFrame : null,
        endFrame: isDidSpecify ? endFrame : null,
        baseFrame: baseFrame,
        DidSpecifyRange: isDidSpecify,
        feedback: intv.reason || "",
        reason: intv.correction || "",
        sentiment: intv.sentiment || 3,
        timeSpentWritingFeedBackSec: Number((((intv.lastModifiedAt || Date.now()) - (intv.createdAt || Date.now())) / 1000).toFixed(2))
      };
    });

    return {
      prolificId: prolificId,
      episodeCount: episodeCount,
      fileName: episode.fileName || fileName || "uploaded.json",
      timeSpentOnPageSec: sessionDurationSec,
      videoPauseCount: pauseCountRef.current,
      playbackSpeedChanges: playbackSpeedChangesRef.current,
      feedbackDetails: feedbackDetails,
    };
  };

  // 최종 export
  const handleExport = async () => {
    const payload = generatePayload();
    if (!payload) return;

    try {
      setIsSaving(true);
      await saveFeedbackToFirestore(payload);
      alert("Firestore 저장에 성공했습니다!");
    } catch (err) {
      console.error(err);
      alert("Firestore 저장에 실패했습니다. src/firebase.js의 설정을 갱신해주세요.");
    } finally {
      setIsSaving(false);
      exportJSON(payload, "error_info.json");
    }
  };

  const handleNextEpisodeClick = async () => {
    if (hasEpisode) {
      const payload = generatePayload();
      if (payload) {
        try {
          setIsSaving(true);
          await saveFeedbackToFirestore(payload);
        } catch (err) {
          console.error(err);
          const ok = window.confirm("Firestore 저장에 실패했습니다. 이대로 다음 에피소드로 넘어가시겠습니까?");
          if (!ok) {
            setIsSaving(false);
            return;
          }
        } finally {
          setIsSaving(false);
        }
      }
    }
    
    if (currentMapIdx < mapOrder.length - 1) {
      const nextIdx = currentMapIdx + 1;
      loadMapByIndex(mapOrder[nextIdx]);
      setCurrentMapIdx(nextIdx);
      setEpisodeCount(nextIdx + 1);
    } else {
      setInstructionStep(5); // 끝
    }
  };

  // 업로드 버튼 기준 pill 스타일
  const pillStyle = {
    background: "#333333",
    color: "#f0f0f0",
    borderRadius: "6px",
  };

  // 공통 버튼 스타일
  const commonButtonStyle = {
    ...pillStyle,
    padding: "6px 16px",
    border: "none",
    fontWeight: 600,
    fontSize: "0.9em",
    cursor: "pointer",
    outline: "none",
  };

  // 메인 화면 (플레이스홀더 온보딩)
  if (instructionStep < 4) {
    let btnText = "Next";
    let isDisabled = false;
    let onNextClick = () => setInstructionStep(st => st + 1);

    if (instructionStep === -1) {
      isDisabled = prolificId.trim().length === 0;
    } else if (instructionStep === 2) {
      const q1Correct = quiz1Answer === 2;
      const q2Correct = Object.keys(quiz2Matches).length === 5 &&
        quiz2Matches.onion === "Onion" &&
        quiz2Matches.pot === "Pot" &&
        quiz2Matches.dish === "Dish" &&
        quiz2Matches.chef === "AI Chef" &&
        quiz2Matches.serve === "Serving Area";
      const q3Correct = quiz3Order.join("") === "1234";
      isDisabled = !(q1Correct && q2Correct && q3Correct);
    } else if (instructionStep === 3) {
      btnText = "Start Experiment";
      isDisabled = !hasReadInstructions;
    }

    return (
      <div style={{ zoom: 1.1, minHeight: "100vh", width: "100%", background: "#0d0d0d", color: "#f0f0f0", display: "flex", flexDirection: "column", padding: "40px 60px", boxSizing: "border-box", fontFamily: "Inter, sans-serif", overflowX: "hidden", overflowY: "auto" }}>

        {/* 상단 헤더 컨테이너: Back/Next 네비게이션 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "40px" }}>

          {/* 좌상단 BACK 버튼 */}
          <div style={{ visibility: instructionStep > -1 ? "visible" : "hidden" }}>
            <button
              onClick={() => setInstructionStep(st => Math.max(-1, st - 1))}
              style={{
                padding: "14px 40px", fontSize: "16px", fontWeight: "700",
                background: "transparent",
                color: "#aaa",
                border: "1px solid #444", borderRadius: "8px",
                cursor: "pointer",
                transition: "all 0.2s"
              }}
              onMouseOver={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "#888"; }}
              onMouseOut={(e) => { e.currentTarget.style.color = "#aaa"; e.currentTarget.style.borderColor = "#444"; }}
            >
              ← Back
            </button>
          </div>

          {/* 우상단 NEXT 버튼 */}
          {instructionStep === 3 ? (
            <button
              disabled={isDisabled}
              onClick={() => {
                if (mapOrder.length > 0) {
                  loadMapByIndex(mapOrder[0]);
                  setCurrentMapIdx(0);
                  setEpisodeCount(1);
                  setInstructionStep(4);
                }
              }}
              style={{
                padding: "14px 40px", fontSize: "16px", fontWeight: "700",
                background: isDisabled ? "#333" : "#fcd34d",
                color: isDisabled ? "#888" : "#000",
                border: "none", borderRadius: "8px",
                cursor: isDisabled ? "not-allowed" : "pointer",
                boxShadow: "none",
                flexShrink: 0, transition: "all 0.2s",
                pointerEvents: isDisabled ? "none" : "auto",
                opacity: isDisabled ? 0.8 : 1
              }}
            >
              Start Experiment
            </button>
          ) : (
            <button
              disabled={isDisabled}
              onClick={onNextClick}
              style={{
                padding: "14px 40px", fontSize: "16px", fontWeight: "700",
                background: isDisabled ? "#333" : "#fcd34d",
                color: isDisabled ? "#888" : "#000",
                border: "none", borderRadius: "8px",
                cursor: isDisabled ? "not-allowed" : "pointer",
                boxShadow: "none",
                flexShrink: 0, transition: "all 0.2s"
              }}
            >
              {btnText} →
            </button>
          )}
        </div>

        {/* 메인 콘텐츠 영역 (maxWidth 제한 해제) */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", width: "100%" }}>
          {instructionStep === -1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "24px", width: "100%", alignItems: "center", justifyContent: "flex-start", flex: 1, marginTop: "10vh" }}>
              <div style={{ textAlign: "center", marginBottom: "20px" }}>
                <h1 style={{ fontSize: "40px", fontWeight: "800", margin: "0 0 12px 0" }}>Welcome! 👋</h1>
                <p style={{ fontSize: "20px", color: "#aaa", margin: 0, lineHeight: 1.5 }}>Please enter your Prolific ID to begin.</p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", width: "100%", maxWidth: "400px", background: "#111", padding: "30px", borderRadius: "16px", border: "1px solid #222" }}>
                <label style={{ fontSize: "14px", fontWeight: "600", color: "#888", textTransform: "uppercase", letterSpacing: "1px" }}>Prolific ID</label>
                <input
                  type="text"
                  placeholder="Enter your Prolific ID"
                  value={prolificId}
                  onChange={(e) => setProlificId(e.target.value)}
                  style={{
                    padding: "16px 20px",
                    borderRadius: "8px",
                    border: "1px solid #333",
                    background: "#0a0a0c",
                    color: "#fff",
                    fontSize: "18px",
                    outline: "none",
                    width: "100%",
                    boxSizing: "border-box",
                    transition: "border-color 0.2s"
                  }}
                  onFocus={(e) => e.target.style.borderColor = "#fcd34d"}
                  onBlur={(e) => e.target.style.borderColor = "#333"}
                />
              </div>
            </div>
          )}

          {instructionStep === 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "40px" }}>
              <style>{`
                 @keyframes mouseMoveClick {
                   0% { transform: translate(40px, 80px) rotate(-15deg); opacity: 0; }
                   10% { transform: translate(40px, 80px) rotate(-15deg); opacity: 1; }
                   20% { transform: translate(0px, 5px) rotate(-15deg); }
                   23% { transform: translate(0px, 5px) rotate(-15deg) scale(0.8); }
                   27% { transform: translate(0px, 5px) rotate(-15deg) scale(1); }
                   35% { transform: translate(0px, 5px) rotate(-15deg); }
                   45% { transform: translate(52px, 82px) rotate(-15deg); }
                   48% { transform: translate(52px, 82px) rotate(-15deg) scale(0.8); }
                   52% { transform: translate(52px, 82px) rotate(-15deg) scale(1); }
                   75% { transform: translate(60px, 90px) rotate(-15deg); opacity: 1; }
                   85% { opacity: 0; }
                   100% { transform: translate(40px, 80px) rotate(-15deg); opacity: 0; }
                 }
                 @keyframes buttonClickMock {
                   0%, 20% { transform: scale(1); boxShadow: 0 0 28px rgba(252, 211, 77, 0.4); }
                   23% { transform: scale(0.94); boxShadow: 0 0 12px rgba(252, 211, 77, 0.8); background: #fde68a; }
                   27%, 100% { transform: scale(1); boxShadow: 0 0 28px rgba(252, 211, 77, 0.4); background: #fcd34d; }
                 }
                 @keyframes likertFadeIn {
                   0%, 25% { opacity: 0; transform: translateY(-10px); pointer-events: none; }
                   30%, 85% { opacity: 1; transform: translateY(0); pointer-events: auto; }
                   90%, 100% { opacity: 0; transform: translateY(-10px); pointer-events: none; }
                 }
                 @keyframes likertPointClick {
                   0%, 48% { background: #3f3f46; transform: scale(1); boxShadow: inset 0 2px 4px rgba(0,0,0,0.5); }
                   50% { background: #22c55e; transform: scale(0.8); boxShadow: 0 0 12px rgba(34,197,94,0.6); } 
                   55%, 85% { background: #22c55e; transform: scale(1.2); boxShadow: 0 0 16px rgba(34,197,94,0.8); }
                   90%, 100% { background: #3f3f46; transform: scale(1); boxShadow: inset 0 2px 4px rgba(0,0,0,0.5); }
                 }
               `}</style>
              <div>
                <h1 style={{ fontSize: "40px", fontWeight: "800", margin: "0 0 12px 0" }}>Welcome to Our Experiment 👋</h1>
                <p style={{ fontSize: "20px", color: "#aaa", margin: 0, lineHeight: 1.5 }}>
                  In this study, your task is to <strong style={{ color: "#fff" }}>watch AI chef characters work together</strong> and <strong style={{ color: "#fff" }}>give feedback</strong> on their collaboration.
                </p>
              </div>
              <div style={{ marginTop: "40px", display: "flex", flexDirection: "column", gap: "20px" }}>
                <p style={{ fontSize: "18px", fontWeight: "700", color: "#fff", margin: 0 }}>Here is what you will do:</p>
                <div style={{ display: "flex", gap: "24px", alignItems: "stretch" }}>
                  {/* Card 1 */}
                  <div style={{ flex: 1, background: "#111", border: "1px solid #222", borderRadius: "16px", padding: "40px 32px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", justifyContent: "center" }}>

                    {/* Video GIF Mockup Container */}
                    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "12px", marginBottom: "24px" }}>
                      {/* Video Frame */}
                      <div style={{ position: "relative", width: "100%", borderRadius: "8px", overflow: "hidden", border: "1px solid #333", background: "#000", aspectRatio: "2.5/1", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <img src="/7.gif" alt="Gameplay preview" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.85 }} />
                      </div>

                      {/* Fake Progress Bar */}
                      <div style={{ display: "flex", alignItems: "center", width: "100%", height: "16px" }}>
                        <div style={{ flex: 1, height: "4px", background: "#333", borderRadius: "2px", position: "relative" }}>
                          <div style={{ position: "absolute", left: 0, top: 0, width: "35%", height: "100%", background: "#22c55e", borderRadius: "2px" }} />
                          <div style={{ position: "absolute", left: "35%", top: "50%", transform: "translate(-50%, -50%)", width: "12px", height: "12px", borderRadius: "50%", background: "#fff", boxShadow: "0 0 6px rgba(0,0,0,0.6)" }} />
                        </div>
                      </div>
                    </div>
                    <h2 style={{ fontSize: "22px", fontWeight: "700", color: "#fff", margin: "0 0 16px 0", letterSpacing: "0.2px" }}>Watch AI Chefs work together</h2>
                    <p style={{ fontSize: "15px", color: "#999", margin: 0, lineHeight: 1.6 }}>You’ll watch short videos of AI chef characters making onion soup.</p>
                  </div>

                  {/* Card 2 */}
                  <div style={{ flex: 1, background: "#111", border: "1px solid #222", borderRadius: "16px", padding: "40px 32px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", justifyContent: "center" }}>

                    {/* Feedback UI Mockup Container */}
                    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "12px", marginBottom: "24px" }}>
                      {/* Sleek Dark Card */}
                      <div style={{ position: "relative", width: "100%", borderRadius: "8px", border: "1px solid #222", background: "#0a0a0c", aspectRatio: "2.5/1", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", flexShrink: 0 }}>

                        <div style={{ background: "#18181b", padding: "20px 30px", borderRadius: "16px", border: "1px solid #27272a", display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", width: "85%", maxWidth: "320px", boxShadow: "0 10px 30px rgba(0,0,0,0.8)" }}>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", width: "100%", opacity: 0.6 }}>
                            <div style={{ width: "70%", height: "6px", background: "#3f3f46", borderRadius: "3px" }} />
                            <div style={{ width: "45%", height: "6px", background: "#3f3f46", borderRadius: "3px" }} />
                          </div>

                          <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
                            <div style={{
                              background: "#fcd34d",
                              color: "#18181b",
                              padding: "10px 24px",
                              borderRadius: "8px",
                              fontSize: "13px",
                              fontWeight: "700",
                              position: "relative",
                              zIndex: 2,
                              animation: "buttonClickMock 6s ease-in-out infinite"
                            }}>
                              + Add Feedback
                            </div>

                            {/* Likert Scale Container */}
                            <div style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              gap: "10px",
                              background: "#222",
                              padding: "12px 18px",
                              borderRadius: "12px",
                              border: "1px solid #333",
                              position: "absolute",
                              top: "100%",
                              marginTop: "12px",
                              width: "max-content",
                              zIndex: 1,
                              animation: "likertFadeIn 6s ease-in-out infinite",
                              boxShadow: "0 8px 24px rgba(0,0,0,0.6)"
                            }}>
                              <span style={{ fontSize: "11px", color: "#aaa", fontWeight: "600", letterSpacing: "0.2px" }}>RATE THIS BEHAVIOR</span>
                              <div style={{ display: "flex", gap: "14px", alignItems: "center" }}>
                                <span style={{ fontSize: "16px", filter: "grayscale(100%)", opacity: 0.6 }}>👎</span>
                                {[1, 2, 3, 4, 5].map(num => (
                                  <div key={num} style={{
                                    width: "18px", height: "18px",
                                    borderRadius: "50%",
                                    background: "#3f3f46",
                                    boxShadow: "inset 0 2px 4px rgba(0,0,0,0.5)",
                                    animation: num === 5 ? "likertPointClick 6s ease-in-out infinite" : "none"
                                  }} />
                                ))}
                                <span style={{ fontSize: "16px" }}>👍</span>
                              </div>
                            </div>

                            {/* Fake Mouse Cursor Overlay */}
                            <div style={{
                              position: "absolute",
                              top: "6px", left: "50%",
                              marginLeft: "-6px",
                              width: "20px", height: "20px",
                              pointerEvents: "none", zIndex: 10,
                              animation: "mouseMoveClick 6s ease-in-out infinite"
                            }}>
                              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: "drop-shadow(2px 4px 6px rgba(0,0,0,0.5))" }}>
                                <path d="M5.5 3.5L18.5 10.5L12 13L15 20.5L11.5 22L8.5 14.5L3 17.5L5.5 3.5Z" fill="white" stroke="black" strokeWidth="1.5" strokeLinejoin="round" />
                              </svg>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Spacer to match Card 1's progress bar height */}
                      <div style={{ height: "16px", width: "100%" }} />
                    </div>

                    <h2 style={{ fontSize: "22px", fontWeight: "700", color: "#fff", margin: "0 0 16px 0", letterSpacing: "0.2px" }}>Give Feedback</h2>
                    <p style={{ fontSize: "15px", color: "#999", margin: 0, lineHeight: 1.6 }}>Whenever you spot a mistake or effective collaboration, pause the video and share your feedback.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {instructionStep === 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "24px", width: "100%" }}>
              <h1 style={{ fontSize: "40px", fontWeight: "800", margin: 0 }}>How the Kitchen Works</h1>
              <p style={{ fontSize: "20px", color: "#aaa", margin: 0, marginBottom: "20px" }}>The AI chefs' main goal is to work together to cook and serve onion soup.</p>

              {/* To cook onion soup timeline */}
              <div style={{ padding: "20px 24px", background: "#1c1c1c", borderRadius: "12px", border: "1px solid #333", display: "flex", flexDirection: "column", gap: "16px" }}>
                <p style={{ fontSize: "16px", color: "#aaa", margin: 0 }}><strong style={{ color: "#fff" }}>To cook onion soup,</strong> AI chefs need:</p>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", fontSize: "15px", fontWeight: "600" }}>

                  {/* Onions */}
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", background: "#0a0a0c", padding: "10px 16px", borderRadius: "8px", border: "1px solid #333" }}>
                    <div style={{ width: "15px", height: "15px", background: "url('/graphics/terrain.png')", backgroundPosition: "-52px -1px", transform: "scale(1.8)", imageRendering: "pixelated", margin: "0 4px" }} />
                    <span>Onions x 3</span>
                  </div>
                  <span style={{ color: "#666", fontSize: "20px", transform: "translateY(1px)" }}>&rarr;</span>

                  {/* Pot */}
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", background: "#0a0a0c", padding: "10px 16px", borderRadius: "8px", border: "1px solid #333" }}>
                    <div style={{ width: "15px", height: "15px", background: "url('/graphics/terrain.png')", backgroundPosition: "-69px -1px", transform: "scale(1.8)", imageRendering: "pixelated", margin: "0 4px" }} />
                    <span>Pot</span>
                  </div>
                  <span style={{ color: "#666", fontSize: "20px", transform: "translateY(1px)" }}>&rarr;</span>

                  {/* Wait */}
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", background: "#0a0a0c", padding: "10px 16px", borderRadius: "8px", border: "1px solid #333", color: "#fff" }}>
                    <span>⏳ Wait</span>
                  </div>
                  <span style={{ color: "#666", fontSize: "20px", transform: "translateY(1px)" }}>&rarr;</span>

                  {/* Dish */}
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", background: "#0a0a0c", padding: "10px 16px", borderRadius: "8px", border: "1px solid #333" }}>
                    <div style={{ width: "15px", height: "15px", background: "url('/graphics/terrain.png')", backgroundPosition: "-18px -1px", transform: "scale(1.8)", imageRendering: "pixelated", margin: "0 4px" }} />
                    <span>Bring Dish</span>
                  </div>
                  <span style={{ color: "#666", fontSize: "20px", transform: "translateY(1px)" }}>&rarr;</span>

                  {/* Serve */}
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", background: "#0a0a0c", padding: "10px 16px", borderRadius: "8px", border: "1px solid #333" }}>
                    <div style={{ width: "15px", height: "15px", background: "url('/graphics/terrain.png')", backgroundPosition: "-86px -1px", transform: "scale(1.8)", imageRendering: "pixelated", margin: "0 4px" }} />
                    <span>Serve!</span>
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px", width: "100%", marginTop: "12px" }}>
                {[
                  { video: "/1.gif", title: "1. Pick up onions", desc: "Collect onions from the supply", sprite: "url('/graphics/terrain.png')", pos: "-52px -1px", objPos: "center bottom" },
                  { video: "/2.gif", title: "2. Add onions to the pot", desc: "Place 3 onions in the pot to start cooking", sprite: "url('/graphics/terrain.png')", pos: "-69px -1px", objPos: "center top" },
                  { video: "/3.gif", title: "3. Bring a dish to the pot", desc: "As the soup cooks, pick up a dish", sprite: "url('/graphics/terrain.png')", pos: "-18px -1px", objPos: "center 25%" },
                  { video: "/4.gif", title: "4. Serve the onion soup", desc: "Deliver the finished soup to the serving area (grey)", sprite: "url('/graphics/terrain.png')", pos: "-86px -1px", objPos: "center" }
                ].map((item, i) => (
                  <div key={i} style={{ display: "flex", flexDirection: "column", background: "#1c1c1c", borderRadius: "14px", overflow: "hidden", border: "1px solid #333" }}>
                    <div style={{ width: "100%", height: "200px", background: "#000", borderBottom: "1px solid #333", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
                      <img src={item.video} alt="Gameplay sequence preview" style={{ width: "100%", height: "100%", objectFit: "contain", opacity: 0.9 }} />
                    </div>
                    <div style={{ padding: "20px 24px" }}>
                      <strong style={{ fontSize: "16px", display: "block", marginBottom: item.desc ? "10px" : 0 }}>{item.title}</strong>
                      {item.desc && <p style={{ fontSize: "15px", color: "#aaa", margin: 0, lineHeight: 1.5 }}>{item.desc}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {instructionStep === 2 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "24px", width: "100%" }}>
              <h1 style={{ fontSize: "40px", fontWeight: "800", margin: 0 }}>Let's Check Your Understanding</h1>
              <p style={{ fontSize: "20px", color: "#aaa", margin: 0 }}>Watch the gameplay video below and answer all questions correctly to proceed.</p>

              {/* Reference Video Area (Responsive GIF) */}
              <div style={{ width: "100%", maxWidth: "800px", margin: "0 auto", backgroundColor: "#000", borderRadius: "14px", overflow: "hidden", border: "1px solid #333", display: "flex", alignItems: "center", justifyContent: "center", color: "#555", position: "relative", aspectRatio: "2.5/1", boxShadow: "0 10px 30px rgba(0,0,0,0.6)" }}>
                <img src="/7.gif" alt="Gameplay preview" style={{ width: "100%", height: "100%", objectFit: "contain", opacity: 0.9 }} />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

                {/* Quiz 1 */}
                <div style={{ padding: "24px", background: "#1c1c1c", borderRadius: "12px", border: "1px solid #333" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
                    <p style={{ fontSize: "16px", fontWeight: "600", margin: 0, color: "#fff" }}>1. How many AI chefs do you see in the game?</p>
                    {quiz1Answer !== null && quiz1Answer !== 2 && (
                      <span style={{ fontSize: "14px", color: "#ef4444", fontWeight: "600" }}>❌ Incorrect. Please try again.</span>
                    )}
                    {quiz1Answer === 2 && (
                      <span style={{ fontSize: "14px", color: "#22c55e", fontWeight: "600" }}>✅ Correct!</span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "12px" }}>
                    {[1, 2, 3, 4].map(num => (
                      <button
                        key={num}
                        onClick={() => setQuiz1Answer(num)}
                        style={{ padding: "10px 24px", fontSize: "16px", fontWeight: "700", borderRadius: "8px", border: "1px solid #444", background: quiz1Answer === num ? (num === 2 ? "#22c55e" : "#ef4444") : "#2a2a2a", color: quiz1Answer === num ? (num === 2 ? "#000" : "#fff") : "#fff", cursor: "pointer", transition: "all 0.2s" }}
                      >
                        {num}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Quiz 2 */}
                <div style={{ padding: "24px", background: "#1c1c1c", borderRadius: "12px", border: (Object.keys(quiz2Matches).length === 5 && quiz2Matches.onion === "Onion" && quiz2Matches.pot === "Pot" && quiz2Matches.dish === "Dish" && quiz2Matches.chef === "AI Chef" && quiz2Matches.serve === "Serve") ? "1px solid #22c55e" : "1px solid #333" }}>
                  <div style={{ marginBottom: "20px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "6px" }}>
                        <p style={{ fontSize: "16px", fontWeight: "600", margin: 0, color: "#fff" }}>2. Identify the names of the items</p>
                        {Object.entries(quiz2Matches).some(([id, match]) => {
                          return !((id === "onion" && match === "Onion") ||
                            (id === "pot" && match === "Pot") ||
                            (id === "dish" && match === "Dish") ||
                            (id === "chef" && match === "AI Chef") ||
                            (id === "serve" && match === "Serving Area"));
                        }) && (
                            <span style={{ fontSize: "14px", color: "#ef4444", fontWeight: "600" }}>❌ Incorrect. Please try again.</span>
                          )}
                        {(Object.keys(quiz2Matches).length === 5 && quiz2Matches.onion === "Onion" && quiz2Matches.pot === "Pot" && quiz2Matches.dish === "Dish" && quiz2Matches.chef === "AI Chef" && quiz2Matches.serve === "Serving Area") && (
                          <span style={{ fontSize: "14px", color: "#22c55e", fontWeight: "600" }}>✅ Correct!</span>
                        )}
                      </div>
                      <p style={{ fontSize: "14px", color: "#999", margin: 0 }}>Drag the property blocks below and drop them into the matching dashed boxes.</p>
                    </div>
                    <button
                      onClick={() => setQuiz2Matches({})}
                      style={{ background: "transparent", border: "1px solid #444", color: "#aaa", padding: "6px 12px", borderRadius: "6px", cursor: "pointer", fontSize: "13px", display: "flex", alignItems: "center", gap: "6px", transition: "all 0.2s" }}
                      onMouseOver={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "#888"; }}
                      onMouseOut={(e) => { e.currentTarget.style.color = "#aaa"; e.currentTarget.style.borderColor = "#444"; }}
                      title="Reset matching answers"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
                      Reset
                    </button>
                  </div>

                  <div style={{ display: "flex", gap: "10px", marginBottom: "20px", flexWrap: "wrap", minHeight: "40px" }}>
                    {quiz2Words.filter(word => !Object.values(quiz2Matches).includes(word)).map(word => (
                      <div
                        key={word} draggable
                        onDragStart={(e) => { e.dataTransfer.setData("text/plain", word); setTimeout(() => e.target.style.opacity = "0.5", 0); }}
                        onDragEnd={(e) => { e.target.style.opacity = "1"; }}
                        style={{ padding: "8px 16px", background: "#3f3f46", color: "#fff", borderRadius: "20px", fontWeight: "600", cursor: "grab", boxShadow: "0 2px 8px rgba(0,0,0,0.4)" }}
                      >
                        {word}
                      </div>
                    ))}
                  </div>

                  <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                    {[
                      { id: "onion", sprite: "url('/graphics/terrain.png')", pos: "-52px -1px" },
                      { id: "pot", sprite: "url('/graphics/terrain.png')", pos: "-69px -1px" },
                      { id: "dish", sprite: "url('/graphics/terrain.png')", pos: "-18px -1px" },
                      { id: "chef", sprite: "url('/graphics/chefs.png')", pos: "-69px -52px" },
                      { id: "serve", sprite: "url('/graphics/terrain.png')", pos: "-86px -1px" }
                    ].map(item => {
                      const match = quiz2Matches[item.id];
                      const isCorrect = (item.id === "onion" && match === "Onion") ||
                        (item.id === "pot" && match === "Pot") ||
                        (item.id === "dish" && match === "Dish") ||
                        (item.id === "chef" && match === "AI Chef") ||
                        (item.id === "serve" && match === "Serving Area");

                      return (
                        <div key={item.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                          <div style={{ width: "60px", height: "60px", background: "#2a2a2a", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #444", boxShadow: "inset 0 4px 10px rgba(0,0,0,0.5)" }}>
                            <div style={{ width: "15px", height: "15px", background: item.sprite, backgroundPosition: item.pos, transform: "scale(2.5)", imageRendering: "pixelated" }} />
                          </div>
                          <div
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => { e.preventDefault(); const data = e.dataTransfer.getData("text/plain"); if (data) setQuiz2Matches(prev => ({ ...prev, [item.id]: data })); }}
                            onClick={() => { if (match) setQuiz2Matches(prev => { const newMatches = { ...prev }; delete newMatches[item.id]; return newMatches; }) }}
                            title="매칭된 단어를 클릭하면 취소됩니다"
                            style={{ width: "100px", height: "36px", border: match ? (isCorrect ? "2px solid #22c55e" : "2px solid #ef4444") : "2px dashed #555", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", background: match ? (isCorrect ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)") : "transparent", cursor: match ? "pointer" : "default", fontSize: "14px", fontWeight: "600", transition: "all 0.2s" }}
                          >
                            {match ? <span style={{ color: isCorrect ? "#22c55e" : "#ef4444" }}>{match}</span> : <span style={{ color: "#666" }}>Drop here</span>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Quiz 3 */}
                <div style={{ padding: "24px", background: "#1c1c1c", borderRadius: "12px", border: "1px solid #333" }}>
                  <div style={{ marginBottom: "20px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "6px" }}>
                      <p style={{ fontSize: "16px", fontWeight: "600", margin: 0, color: "#fff" }}>3. Arrange the cooking steps</p>
                      {quiz3Order.join("") !== "1234" && (
                        <span style={{ fontSize: "14px", color: "#ef4444", fontWeight: "600", opacity: 0.8 }}>❌ Incorrect order. Please try again.</span>
                      )}
                      {quiz3Order.join("") === "1234" && (
                        <span style={{ fontSize: "14px", color: "#22c55e", fontWeight: "600" }}>✅ Correct!</span>
                      )}
                    </div>
                    <p style={{ fontSize: "14px", color: "#999", margin: 0 }}>Drag the items up or down to place them in the correct sequential order.</p>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {quiz3Order.map((stepId, index) => {
                      const stepsMap = {
                        1: { text: "Pick up onions", sprite: "url('/graphics/terrain.png')", pos: "-52px -1px" },
                        2: { text: "Add onions to the pot", sprite: "url('/graphics/terrain.png')", pos: "-69px -1px" },
                        3: { text: "Bring a dish to the pot", sprite: "url('/graphics/terrain.png')", pos: "-18px -1px" },
                        4: { text: "Serve the onion soup", sprite: "url('/graphics/terrain.png')", pos: "-86px -1px" }
                      };
                      return (
                        <div
                          key={stepId}
                          draggable
                          onDragStart={(e) => { e.dataTransfer.setData("text/plain", index.toString()); setTimeout(() => e.target.style.opacity = "0.4", 0); }}
                          onDragEnd={(e) => { e.target.style.opacity = "1"; }}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            const draggedIdxStr = e.dataTransfer.getData("text/plain");
                            if (draggedIdxStr === "") return;
                            const draggedIdx = Number(draggedIdxStr);
                            const targetIdx = index;
                            if (draggedIdx === targetIdx) return;

                            setQuiz3Order(prev => {
                              const newOrder = [...prev];
                              const [removed] = newOrder.splice(draggedIdx, 1);
                              newOrder.splice(targetIdx, 0, removed);
                              return newOrder;
                            });
                          }}
                          style={{ padding: "12px 16px", background: "#2a2a2a", borderRadius: "8px", border: "1px solid #444", color: "#fff", display: "flex", alignItems: "center", gap: "16px", cursor: "grab", fontWeight: "500", fontSize: "15px", boxShadow: "0 2px 6px rgba(0,0,0,0.4)", transition: "transform 0.2s" }}
                        >
                          <span style={{ fontSize: "18px", color: "#666", display: "flex", alignItems: "center", letterSpacing: "2px" }}>⋮⋮</span>
                          <div style={{ width: "24px", height: "24px", background: "#1c1c1c", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #444" }}>
                            <div style={{ width: "15px", height: "15px", background: stepsMap[stepId].sprite, backgroundPosition: stepsMap[stepId].pos, transform: "scale(1.2)", imageRendering: "pixelated" }} />
                          </div>
                          {stepsMap[stepId].text}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {instructionStep === 3 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "24px", width: "100%" }}>
              <style>{`
                  @keyframes feedbackRangeAdjust {
                    0%, 15% { left: 80px; right: 80px; }
                    25%, 45% { left: 20px; right: 80px; }
                    60%, 80% { left: 20px; right: 20px; }
                    90%, 100% { left: 80px; right: 80px; }
                  }
                  @keyframes mouseDragTimeline {
                    0% { transform: translate(150px, 60px); opacity: 0; }
                    5% { transform: translate(75px, 22px); opacity: 1; }
                    8% { transform: translate(75px, 22px) scale(0.85); }
                    12% { transform: translate(75px, 22px) scale(0.9); }
                    25% { transform: translate(15px, 22px) scale(0.9); }
                    30% { transform: translate(15px, 22px) scale(1); }
                    40% { transform: translate(115px, 22px); }
                    43% { transform: translate(115px, 22px) scale(0.85); }
                    47% { transform: translate(115px, 22px) scale(0.9); }
                    60% { transform: translate(175px, 22px) scale(0.9); }
                    65% { transform: translate(175px, 22px) scale(1); }
                    80% { transform: translate(150px, 60px); opacity: 1; }
                    90%, 100% { transform: translate(150px, 60px); opacity: 0; }
                  }
                  @keyframes buttonClickMock {
                    0%, 20% { transform: scale(1); filter: brightness(1) }
                    23% { transform: scale(0.94); filter: brightness(0.9) }
                    27%, 100% { transform: scale(1); filter: brightness(1) }
                  }
                  @keyframes likertFadeIn {
                    0%, 25% { opacity: 0; transform: translateY(-5px); pointer-events: none; }
                    30%, 85% { opacity: 1; transform: translateY(0); pointer-events: auto; }
                    90%, 100% { opacity: 0; transform: translateY(-5px); pointer-events: none; }
                  }
                  @keyframes likertPointClick {
                    0%, 48% { background: #3f3f46; transform: scale(1); }
                    50% { background: #22c55e; transform: scale(0.8); } 
                    55%, 85% { background: #22c55e; transform: scale(1.2); }
                    90%, 100% { background: #3f3f46; transform: scale(1); }
                  }
                  @keyframes mouseMoveClick3 {
                    0%, 20% { transform: translate(30px, 40px) rotate(-15deg); opacity: 0; }
                    23% { transform: translate(5px, 2px) rotate(-15deg); opacity: 1; }
                    27% { transform: translate(5px, 2px) rotate(-15deg) scale(0.8); }
                    31% { transform: translate(5px, 2px) rotate(-15deg) scale(1); }
                    45% { transform: translate(38px, 48px) rotate(-15deg); }
                    48% { transform: translate(38px, 48px) rotate(-15deg) scale(0.8); }
                    52% { transform: translate(38px, 48px) rotate(-15deg) scale(1); }
                    75% { transform: translate(50px, 55px) rotate(-15deg); opacity: 1; }
                    85% { opacity: 0; }
                    100% { transform: translate(30px, 40px) rotate(-15deg); opacity: 0; }
                  }
                `}</style>

              <h1 style={{ fontSize: "40px", fontWeight: "800", margin: 0 }}>How to Add Feedback</h1>
              <p style={{ fontSize: "20px", color: "#aaa", margin: 0 }}>
                As you watch, pause whenever needed and follow these three steps to share your thoughts on the AI chefs' behavior.
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "24px", minHeight: "420px", marginTop: "12px" }}>

                {/* Card 1 */}
                <div style={{ background: "#151515", borderRadius: "16px", padding: "24px", display: "flex", flexDirection: "column", justifyContent: "space-between", border: "1px solid #222" }}>
                  <div>
                    <div style={{ width: "32px", height: "32px", background: "#1c3e23", color: "#4ade80", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "800", fontSize: "16px", marginBottom: "20px" }}>1</div>
                    <strong style={{ fontSize: "18px", color: "#fff", display: "block", marginBottom: "12px" }}>Pause the Video</strong>
                    <p style={{ color: "#aaa", fontSize: "15px", lineHeight: "1.6", margin: 0 }}>Spot a behavior you want to comment on, then pause the video. Rewatch as needed.</p>
                  </div>
                  <div style={{ width: "100%", height: "120px", borderRadius: "10px", marginTop: "30px", overflow: "hidden", background: "#000", position: "relative", border: "1px solid #333" }}>
                    <img src="/main.gif" alt="Pause video simulation" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.6 }} />
                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <div style={{ width: "48px", height: "48px", background: "#22c55e", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(0,0,0,0.5)" }}>
                        <span style={{ color: "#000", fontSize: "18px", fontWeight: "900", letterSpacing: "1px" }}>II</span>
                      </div>
                    </div>
                    <div style={{ position: "absolute", bottom: "12px", left: "12px", right: "12px", height: "4px", background: "#333", borderRadius: "2px" }}>
                      <div style={{ width: "25%", height: "100%", background: "#22c55e", borderRadius: "2px" }} />
                      <div style={{ position: "absolute", left: "25%", top: "50%", transform: "translate(-50%, -50%)", width: "10px", height: "10px", background: "#fff", borderRadius: "50%", boxShadow: "0 0 4px rgba(0,0,0,0.5)" }} />
                    </div>
                  </div>
                </div>

                {/* Card 2 */}
                <div style={{ background: "#151515", borderRadius: "16px", padding: "24px", display: "flex", flexDirection: "column", justifyContent: "space-between", border: "1px solid #222" }}>
                  <div>
                    <div style={{ width: "32px", height: "32px", background: "#1c3e23", color: "#4ade80", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "800", fontSize: "16px", marginBottom: "20px" }}>2</div>
                    <strong style={{ fontSize: "18px", color: "#fff", display: "block", marginBottom: "12px" }}>Click "+ Add Feedback"</strong>
                    <p style={{ color: "#aaa", fontSize: "15px", lineHeight: "1.6", margin: 0 }}>
                      Use the yellow button on the right panel to add a new entry.<br />
                      Choose whether your feedback is positive or negative.
                    </p>
                  </div>
                  <div style={{ boxSizing: "border-box", width: "100%", height: "120px", borderRadius: "10px", background: "#1c1c1c", border: "1px solid #2a2a2a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", marginTop: "30px", overflow: "visible", position: "relative" }}>
                    <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", width: "100%", transform: "translateY(-15px)" }}>
                      <div style={{
                        background: "#fcd34d",
                        color: "#18181b",
                        padding: "10px 24px",
                        borderRadius: "8px",
                        fontSize: "13px",
                        fontWeight: "700",
                        position: "relative",
                        zIndex: 2,
                        animation: "buttonClickMock 6s ease-in-out infinite"
                      }}>
                        + Add Feedback
                      </div>

                      {/* Likert Scale Container */}
                      <div style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "6px",
                        background: "#222",
                        padding: "8px 12px",
                        borderRadius: "12px",
                        border: "1px solid #333",
                        position: "absolute",
                        top: "100%",
                        marginTop: "8px",
                        width: "max-content",
                        zIndex: 1,
                        animation: "likertFadeIn 6s ease-in-out infinite",
                        boxShadow: "0 8px 24px rgba(0,0,0,0.6)"
                      }}>
                        <span style={{ fontSize: "10px", color: "#aaa", fontWeight: "600", letterSpacing: "0.2px", textTransform: "uppercase" }}>RATE THIS BEHAVIOR</span>
                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                          <span style={{ fontSize: "12px", filter: "grayscale(100%)", opacity: 0.6 }}>👎</span>
                          {[1, 2, 3, 4, 5].map(num => (
                            <div key={num} style={{
                              width: "14px", height: "14px",
                              borderRadius: "50%",
                              background: "#3f3f46",
                              boxShadow: "inset 0 2px 4px rgba(0,0,0,0.5)",
                              animation: num === 5 ? "likertPointClick 6s ease-in-out infinite" : "none"
                            }} />
                          ))}
                          <span style={{ fontSize: "12px" }}>👍</span>
                        </div>
                      </div>

                      {/* Fake Mouse Cursor Overlay */}
                      <div style={{
                        position: "absolute",
                        top: "8px", left: "50%",
                        marginLeft: "-6px",
                        width: "20px", height: "20px",
                        pointerEvents: "none", zIndex: 10,
                        animation: "mouseMoveClick3 6s ease-in-out infinite"
                      }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: "drop-shadow(2px 4px 6px rgba(0,0,0,0.5))" }}>
                          <path d="M5.5 3.5L18.5 10.5L12 13L15 20.5L11.5 22L8.5 14.5L3 17.5L5.5 3.5Z" fill="white" stroke="black" strokeWidth="1.5" strokeLinejoin="round" />
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Card 3 */}
                <div style={{ background: "#151515", borderRadius: "16px", padding: "24px", display: "flex", flexDirection: "column", justifyContent: "space-between", border: "1px solid #222" }}>
                  <div>
                    <div style={{ width: "32px", height: "32px", background: "#1c3e23", color: "#4ade80", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "800", fontSize: "16px", marginBottom: "20px" }}>3</div>
                    <strong style={{ fontSize: "18px", color: "#fff", display: "block", marginBottom: "12px" }}>Choose the start and end frames to give feedback.</strong>
                    <p style={{ color: "#aaa", fontSize: "15px", lineHeight: "1.6", margin: 0 }}>Pick a range by dragging the start and end points, then write your feedback.</p>
                  </div>
                  <div style={{ boxSizing: "border-box", width: "100%", height: "120px", borderRadius: "10px", background: "#1c1c1c", border: "1px solid #2a2a2a", display: "flex", alignItems: "center", justifyContent: "center", marginTop: "30px", flexDirection: "column" }}>
                    <div style={{ width: "200px", height: "80px", position: "relative" }}>
                      {/* Timeline Track */}
                      <div style={{ position: "absolute", top: "15px", left: "0", right: "0", height: "20px", background: "#000", border: "1px solid #333", borderRadius: "4px", overflow: "hidden", display: "flex", alignItems: "flex-end", padding: "0 2px" }}>
                        {[...Array(20)].map((_, i) => (
                          <div key={i} style={{ flex: 1, borderRight: "1px solid #222", height: (i + 1) % 5 === 0 ? "10px" : "4px" }} />
                        ))}
                      </div>

                      {/* Yellow Block */}
                      <div style={{ position: "absolute", top: "13px", height: "24px", background: "rgba(252, 211, 77, 0.35)", borderRadius: "2px", animation: "feedbackRangeAdjust 7s infinite ease-in-out" }}>
                        {/* Left Handle */}
                        <div style={{ position: "absolute", left: "-2px", top: "4px", width: "4px", height: "16px", background: "#fff", borderRadius: "2px", boxShadow: "0 0 4px rgba(0,0,0,0.5)" }} />
                        {/* Right Handle */}
                        <div style={{ position: "absolute", right: "-2px", top: "4px", width: "4px", height: "16px", background: "#fff", borderRadius: "2px", boxShadow: "0 0 4px rgba(0,0,0,0.5)" }} />
                      </div>

                      {/* Text */}
                      <p style={{ position: "absolute", top: "45px", width: "100%", margin: 0, color: "#ddd", fontSize: "14px", fontWeight: "600", textAlign: "center", letterSpacing: "0.5px", zIndex: 1 }}>Feedback Range</p>

                      {/* Mouse Cursor */}
                      <div style={{ position: "absolute", pointerEvents: "none", zIndex: 10, animation: "mouseDragTimeline 7s infinite ease-in-out", left: 0, top: 0 }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: "drop-shadow(2px 4px 6px rgba(0,0,0,0.5))" }}>
                          <path d="M5.5 3.5L18.5 10.5L12 13L15 20.5L11.5 22L8.5 14.5L3 17.5L5.5 3.5Z" fill="white" stroke="black" strokeWidth="1.5" strokeLinejoin="round" />
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>

              </div>



              <div style={{ display: "flex", alignItems: "center", gap: "12px", background: hasReadInstructions ? "rgba(34,197,94,0.1)" : "#1a1a1a", padding: "16px 20px", borderRadius: "12px", border: hasReadInstructions ? "1px solid #22c55e" : "1px solid #333", marginTop: "20px" }}>
                <input type="checkbox" checked={hasReadInstructions} onChange={e => setHasReadInstructions(e.target.checked)} id="terms" style={{ width: "20px", height: "20px", accentColor: "#22c55e" }} />
                <label htmlFor="terms" style={{ fontSize: "16px", cursor: "pointer", color: hasReadInstructions ? "#22c55e" : "#fff", fontWeight: "500" }}>I have carefully read and understand the instructions.</label>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (instructionStep === 5) {
    return (
      <div style={{ display: "flex", width: "100%", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "#050505", color: "#fff", flexDirection: "column", fontFamily: "Inter, sans-serif", padding: "40px", boxSizing: "border-box" }}>
        
        <style>{`
          @keyframes slideUpFade {
            0% { opacity: 0; transform: translateY(20px); }
            100% { opacity: 1; transform: translateY(0); }
          }
          @keyframes checkmarkBreathe {
            0%, 100% { transform: scale(1); filter: drop-shadow(0 0 10px rgba(74, 222, 128, 0.4)); }
            50% { transform: scale(1.05); filter: drop-shadow(0 0 20px rgba(74, 222, 128, 0.8)); }
          }
        `}</style>
        
        <div style={{
          background: "#0a0a0c", 
          border: "1px solid #1f1f23", 
          borderRadius: "24px", 
          padding: "60px", 
          display: "flex", 
          flexDirection: "column", 
          alignItems: "center", 
          maxWidth: "500px", 
          width: "100%",
          boxShadow: "0 24px 60px rgba(0,0,0,0.8)",
          animation: "slideUpFade 0.6s cubic-bezier(0.16, 1, 0.3, 1)",
          boxSizing: "border-box"
        }}>
          {/* Checkmark icon with green soft glow */}
          <div style={{ 
            width: "80px", 
            height: "80px", 
            borderRadius: "40px", 
            background: "rgba(34, 197, 94, 0.1)", 
            display: "flex", 
            alignItems: "center", 
            justifyContent: "center", 
            marginBottom: "32px",
            border: "1px solid rgba(34, 197, 94, 0.2)",
            animation: "checkmarkBreathe 3s ease-in-out infinite"
          }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>

          <h1 style={{ fontSize: "36px", fontWeight: "800", color: "#fff", margin: "0 0 12px 0", textAlign: "center", letterSpacing: "-0.5px" }}>Thank You!</h1>
          <p style={{ fontSize: "16px", color: "#a1a1aa", margin: "0 0 40px 0", textAlign: "center", lineHeight: "1.6" }}>Your feedback has been successfully recorded. We appreciate your time and effort in helping our research.</p>
          
          <div style={{ 
            background: "#121214", 
            padding: "24px", 
            borderRadius: "16px", 
            border: "1px dashed #27272a", 
            width: "100%", 
            display: "flex", 
            flexDirection: "column", 
            gap: "16px", 
            alignItems: "center",
            boxSizing: "border-box" 
          }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
              <span style={{ color: "#71717a", fontSize: "12px", textTransform: "uppercase", letterSpacing: "1px", fontWeight: "700" }}>Completion Code</span>
              <strong style={{ color: "#fcd34d", fontSize: "28px", letterSpacing: "4px", fontFamily: "monospace", textShadow: "0 0 20px rgba(252, 211, 77, 0.3)" }}>C5V8YMO7</strong>
            </div>
          </div>

          <div style={{ width: "100%", marginTop: "32px", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <a 
              href="https://app.prolific.com/submissions/complete?cc=C5V8YMO7" 
              style={{ 
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "10px",
                width: "100%",
                padding: "16px 24px", 
                background: "#fcd34d", 
                color: "#18181b", 
                fontWeight: "700", 
                textDecoration: "none", 
                borderRadius: "12px", 
                fontSize: "16px", 
                boxSizing: "border-box"
              }}
            >
              Return to Prolific
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"></line>
                <polyline points="12 5 19 12 12 19"></polyline>
              </svg>
            </a>
            <p style={{ marginTop: "16px", fontSize: "13px", color: "#52525b", textAlign: "center", margin: "16px 0 0 0" }}>
              Or use this redirect URL: <a href="https://app.prolific.com/submissions/complete?cc=C5V8YMO7" style={{ color: "#71717a", textDecoration: "underline", wordBreak: "break-all" }}>https://app.prolific.com/submissions/complete?cc=C5V8YMO7</a>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        background: "#080808",
        color: "#f0f0f0",
        height: "100vh",
        width: "100vw",
        boxSizing: "border-box",
        overflow: "hidden",
        fontFamily: "Inter, sans-serif",
        position: "relative"
      }}
    >
      {/* 🚀 Faint Header Separator */}
      {hasEpisode && (
        <>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "72px", background: "#0a0a0a", zIndex: 50 }} />
          <div style={{ position: "absolute", top: "72px", left: 0, right: 0, height: "1px", background: "rgba(255, 255, 255, 0.06)", zIndex: 50 }} />
        </>
      )}

      {/* Absolute Top Level Controls */}
      <div style={{ position: "absolute", top: "24px", left: "30px", zIndex: 100, display: "flex", alignItems: "center", gap: "12px" }}>
        {hasEpisode && (
          <>
            <div style={{ background: "rgba(239, 68, 68, 0.15)", color: "#ef4444", padding: "6px 12px", borderRadius: "6px", fontSize: "13px", fontWeight: "700", border: "1px solid rgba(239, 68, 68, 0.4)", display: "flex", alignItems: "center", gap: "6px", letterSpacing: "0.2px" }}>
              <span>🚨</span> Please do not refresh this page
            </div>
          </>
        )}
      </div>

      {/* Absolute Top Right Controls (Export & Next Episode) */}
      <div style={{ position: "absolute", top: "24px", right: "30px", zIndex: 100, display: "flex", gap: "10px" }}>
        <button
          onClick={handleNextEpisodeClick}
          disabled={isSaving}
          style={{ background: "#111", color: "#fff", border: "1px solid #333", padding: "10px 20px", borderRadius: "8px", fontSize: "14px", fontWeight: "700", cursor: isSaving ? "wait" : "pointer", transition: "all 0.2s ease", display: "flex", justifyContent: "center", alignItems: "center", gap: "6px", opacity: isSaving ? 0.7 : 1 }}
          onMouseOver={e => { 
            if(!isSaving) {
              e.currentTarget.style.background = "#fcd34d"; 
              e.currentTarget.style.color = "#000";
              e.currentTarget.style.borderColor = "#fcd34d";
            } 
          }}
          onMouseOut={e => { 
            if(!isSaving) {
              e.currentTarget.style.background = "#111"; 
              e.currentTarget.style.color = "#fff";
              e.currentTarget.style.borderColor = "#333";
            } 
          }}
        >
          {isSaving
            ? "Saving..."
            : episodeCount >= ALL_MAPS.length
              ? "Finish Experiment"
              : `Next episode (${episodeCount}/${ALL_MAPS.length}) ▶`}
        </button>
      </div>



      {/* Main viewer */}
      <div
        style={{
          textAlign: "center",
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "stretch",
          position: "relative",
          height: "100%",
          minHeight: 0,
          paddingTop: hasEpisode ? "88px" : 0,
          paddingBottom: 0,
          boxSizing: "border-box",
          overflow: "hidden"
        }}
      >

        <div
          style={{
            width: "100%",
            maxWidth: "800px",
            flex: 1,
            minHeight: 0,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            paddingBottom: `${Math.max(bottomDockHeight, 120) + 16}px`,
            boxSizing: "border-box"
          }}
        >

          {/* 에이전트 화면 */}
          <div
            style={{
              width: "100%",
              height: "100%",
              minHeight: 0,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            {hasEpisode && frame ? (
              <div
                onClick={togglePlay}
                style={{
                  width: "100%",
                  height: "100%",
                  minHeight: 0,
                  maxWidth: "100%",
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  cursor: "pointer",
                  position: "relative"
                }}
              >
                <OvercookScene
                  staticInfo={episode.staticInfo}
                  frame={frame}
                  frames={episode.frames}
                  isReplaying={isReplaying}
                  playbackRate={playbackRate}
                  frameDuration={frameDuration}
                />
                
                {frameIndex === 0 && !isPlaying && (
                  <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", background: "rgba(0, 0, 0, 0.75)", padding: "16px 36px", borderRadius: "100px", border: "1px solid rgba(255, 255, 255, 0.2)", display: "flex", alignItems: "center", backdropFilter: "blur(8px)", pointerEvents: "none", boxShadow: "0 10px 30px rgba(0,0,0,0.5)" }}>
                    <span style={{ fontSize: "20px", fontWeight: "700", color: "#fff", letterSpacing: "0.5px", textShadow: "0 2px 4px rgba(0,0,0,0.5)" }}>Click to start the video</span>
                  </div>
                )}
              </div>
            ) : (
              <div
                style={{
                  border: "1px dashed #444",
                  borderRadius: "10px",
                  padding: "60px 40px",
                  color: "#777",
                  fontSize: "0.95em",
                  width: "100%",
                  background: "#0c0c0c"
                }}
              >
                JSON trajectory 파일을 업로드하면 여기에서 플레이 화면을 볼 수
                있습니다.
              </div>
            )}
          </div>

        </div>

        {/* Bottom Control Bar (Embedded Dock) */}
        <div
          ref={bottomDockRef}
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            width: "100%",
            background: "#080808",
            borderTop: "1px solid #1a1a1a",
            padding: "24px 40px",
            display: "flex",
            flexDirection: "column",
            gap: "24px",
            boxSizing: "border-box",
            zIndex: 50
          }}
        >
          {/* 하단 전체 Slider */}
          <div style={{ width: "100%", position: "relative" }}>
            {/* Feedback markers overlay */}
            {hasEpisode && intervals.map((intv, i) => {
              const base = intv.baseFrame;
              let s = intv.isFullRange ? base : base + intv.startOffset;
              let e = intv.isFullRange ? base : base + intv.endOffset;
              s = Math.max(s, 0);
              e = Math.min(e, totalFrames - 1);
              if (s > e) [s, e] = [e, s];

              const tFrames = totalFrames > 0 ? totalFrames - 1 : 1;
              const leftPerc = (s / tFrames) * 100;
              const widthPerc = ((e - s) / tFrames) * 100;
              const basePerc = (base / tFrames) * 100;
              const isSelected = selectedInterval?.index === i;

              return (
                <div key={i} style={{ position: "absolute", top: "-14px", left: "6px", right: "6px", height: "14px", pointerEvents: "none", zIndex: 10 }}>
                  {/* Range Highlight */}
                  <div style={{ position: "absolute", left: `${leftPerc}%`, width: `${widthPerc}%`, top: "4px", height: "6px", background: isSelected ? "rgba(252, 211, 77, 0.55)" : "rgba(150, 150, 150, 0.3)", borderRadius: "3px", transition: "all 0.2s" }} />
                  {/* Base Frame Tick */}
                  <div style={{ position: "absolute", left: `${basePerc}%`, top: "0px", width: "3px", height: "14px", background: isSelected ? "#fcd34d" : "#777", transform: "translateX(-50%)", borderRadius: "2px", transition: "all 0.2s" }} />
                </div>
              );
            })}

            <input
              type="range"
              min={0}
              max={totalFrames > 0 ? totalFrames - 1 : 0}
              value={frameIndex}
              onChange={(e) => {
                const val = Number(e.target.value);
                setFrameIndex(val);
                setElapsed(val * frameDuration);
                setIsPlaying(prev => { if (prev) pauseCountRef.current += 1; return false; });
              }}
              disabled={!hasEpisode}
              style={{
                width: "100%",
                margin: 0,
                cursor: hasEpisode ? "pointer" : "default",
                accentColor: "#fcd34d"
              }}
            />
          </div>

          {/* 컨트롤 Row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
            {/* Left Info */}
            <div style={{ display: "flex", alignItems: "center", color: "#888", fontSize: "13px", minWidth: "100px", flex: 1 }}>
              <span style={{ whiteSpace: "nowrap" }}>
                Frame {frameIndex} / {hasEpisode ? totalFrames - 1 : 0}
              </span>
            </div>

            {/* Center Controls */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0, justifyContent: "center" }}>
              <button
                onClick={() => {
                  setFrameIndex(0);
                  setElapsed(0);
                  setIsPlaying(prev => { if (prev) pauseCountRef.current += 1; return false; });
                }}
                disabled={!hasEpisode}
                style={{ background: "transparent", border: "none", color: hasEpisode ? "#777" : "#333", cursor: hasEpisode ? "pointer" : "default", fontSize: "16px", display: "flex", alignItems: "center", justifyContent: "center", width: "32px", height: "32px", outline: "none" }}
              >
                ⏮
              </button>
              <button
                onClick={() => {
                  const target = Math.max(0, frameIndex - 1);
                  setFrameIndex(target);
                  setElapsed(target * frameDuration);
                  setIsPlaying(prev => { if (prev) pauseCountRef.current += 1; return false; });
                }}
                disabled={!hasEpisode}
                style={{ background: "transparent", border: "none", color: hasEpisode ? "#fff" : "#333", cursor: hasEpisode ? "pointer" : "default", fontSize: "16px", display: "flex", alignItems: "center", justifyContent: "center", width: "32px", height: "32px", outline: "none" }}
              >
                ◀
              </button>
              <button
                onClick={togglePlay}
                disabled={!hasEpisode}
                style={{
                  background: "transparent",
                  color: hasEpisode ? "#fff" : "#333",
                  border: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: hasEpisode ? "pointer" : "default",
                  fontSize: "20px",
                  width: "40px",
                  height: "40px",
                  outline: "none"
                }}
              >
                {isPlaying ? "⏸" : "▶"}
              </button>
              <button
                onClick={() => {
                  const target = Math.min(totalFrames - 1, frameIndex + 1);
                  setFrameIndex(target);
                  setElapsed(target * frameDuration);
                  setIsPlaying(prev => { if (prev) pauseCountRef.current += 1; return false; });
                }}
                disabled={!hasEpisode}
                style={{ background: "transparent", border: "none", color: hasEpisode ? "#fff" : "#333", cursor: hasEpisode ? "pointer" : "default", fontSize: "16px", display: "flex", alignItems: "center", justifyContent: "center", width: "32px", height: "32px", outline: "none" }}
              >
                ▶
              </button>
              <button
                onClick={() => {
                  const target = totalFrames > 0 ? totalFrames - 1 : 0;
                  setFrameIndex(target);
                  setElapsed(target * frameDuration);
                  if (isPlaying) pauseCountRef.current += 1;
                  setIsPlaying(false);
                }}
                disabled={!hasEpisode}
                style={{ background: "transparent", border: "none", color: hasEpisode ? "#777" : "#333", cursor: hasEpisode ? "pointer" : "default", fontSize: "16px", display: "flex", alignItems: "center", justifyContent: "center", width: "32px", height: "32px", outline: "none" }}
              >
                ⏭
              </button>
            </div>

            {/* Right Controls */}
            <div style={{ flex: 1, minWidth: "100px", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "13px", color: "#888", fontWeight: "600", display: hasEpisode ? "block" : "none" }}>Speed</span>
              <select
                value={playbackRate}
                onChange={(e) => {
                  const newSpeed = Number(e.target.value);
                  setPlaybackRate(newSpeed);
                  playbackSpeedChangesRef.current.push({
                    speed: newSpeed,
                    timestampSec: Math.round((Date.now() - sessionStartRef.current) / 1000),
                    frame: frameIndex
                  });
                }}
                disabled={!hasEpisode}
                style={{
                  background: hasEpisode ? "#2c2c2c" : "transparent",
                  color: hasEpisode ? "#fff" : "#444",
                  border: hasEpisode ? "1px solid #555" : "1px solid #2a2a2a",
                  padding: "4px 6px 4px 10px",
                  borderRadius: "6px",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: hasEpisode ? "pointer" : "default",
                  outline: "none",
                  textAlign: "center",
                  boxShadow: hasEpisode ? "0 2px 6px rgba(0,0,0,0.4)" : "none",
                  transition: "all 0.2s"
                }}
              >
                <option value={0.5}>0.5x</option>
                <option value={1}>1.0x</option>
                <option value={1.5}>1.5x</option>
                <option value={2}>2.0x</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Border separator */}
      {hasEpisode && (
        <div style={{ width: "1px", height: "100%", background: "#1a1a1a" }} />
      )}

      {/* Right Panel */}
      <div
        style={{
          width: `${panelWidth}px`,
          flexShrink: 0,
          borderLeft: hasEpisode ? "none" : "1px solid #1a1a1a",
          padding: "80px 24px 24px 24px",
          textAlign: "left",
          opacity: !hasEpisode ? 0.4 : 1,
          pointerEvents: !hasEpisode ? "none" : "auto",
          transition: "opacity 0.3s ease",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "#080808",
          boxSizing: "border-box"
        }}
      >
        <div style={{ marginBottom: "20px" }}>


          {/* 타이틀 및 리셋(Reset) 버튼 */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "16px" }}>
            <h3 style={{ margin: 0, color: "#fff", fontSize: "20px", fontWeight: "700", letterSpacing: "-0.5px" }}>Feedback</h3>

          </div>

          <button
            onClick={() => {
              if (!episode || totalFrames === 0) return;
              const targetFrame = frameIndex;
              setRawMarkers((prev) => [...prev, targetFrame]);

              const newInterval = {
                baseFrame: targetFrame,
                startOffset: -2,
                endOffset: 2,
                reason: "",
                correction: "",
                data: [],
                isFullRange: false,
                createdAt: Date.now(),
                lastModifiedAt: Date.now(),
              };
              setIntervals((prev) => [...prev, newInterval]);
              setSelectedInterval({ index: intervals.length, ...newInterval });
            }}
            style={{
              width: "100%",
              background: "#fcd34d",
              color: "#000",
              border: "none",
              padding: "8px 0",
              borderRadius: "6px",
              fontSize: "13px",
              fontWeight: "700",
              cursor: "pointer",
              outline: "none",
              transition: "opacity 0.2s"
            }}
            onMouseOver={e => e.target.style.opacity = 0.8}
            onMouseOut={e => e.target.style.opacity = 1}
          >
            + Add Feedback
          </button>
        </div>

        {!hasEpisode ? (
          <div
            style={{
              padding: "40px 20px",
              textAlign: "center",
              color: "#666",
              fontSize: "13px",
            }}
          >
            JSON 파일을 업로드해주세요
          </div>
        ) : intervals.length === 0 ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", color: "#f0f0f0", fontSize: "16px", textAlign: "center", gap: "14px", padding: "0 20px" }}>
            <span style={{ fontSize: "36px", opacity: 0.9 }}>💬</span>
            <div style={{ lineHeight: "1.6", fontWeight: "500", letterSpacing: "0.2px" }}>
              No feedback yet.<br />
              <span style={{ color: "#bbb", fontSize: "15px", fontWeight: "400" }}>Select a frame to add feedback.</span>
            </div>
          </div>
        ) : (
          <div
            ref={scrollContainerRef}
            style={{
              flex: 1,
              overflowY: "auto",
              textAlign: "left",
              paddingRight: "8px",
              paddingBottom: "20px",
              boxSizing: "border-box",
            }}
          >
            {intervals.map((intv, i) => {
              const isSelected = selectedInterval?.index === i;

              const baseFrame = intv.baseFrame;
              let startFrame = intv.isFullRange ? baseFrame : baseFrame + intv.startOffset;
              let endFrame = intv.isFullRange ? baseFrame : baseFrame + intv.endOffset;

              startFrame = Math.max(startFrame, 0);
              endFrame = Math.min(endFrame, totalFrames - 1);

              if (startFrame > endFrame) {
                const tmp = startFrame;
                startFrame = endFrame;
                endFrame = tmp;
              }



              return (
                <div
                  key={i}
                  onClick={() => {
                    if (!isSelected) {
                      setSelectedInterval({ index: i, ...intv });
                      handleReplayFromBase(intv);
                    }
                  }}
                  style={{
                    border: isSelected ? "1px solid rgba(255, 255, 255, 0.3)" : "1px solid #2a2a2a",
                    borderRadius: "10px",
                    padding: "20px",
                    marginBottom: "16px",
                    background: "#151515",
                    cursor: isSelected ? "default" : "pointer",
                    transition: "all 0.2s ease",
                    position: "relative",
                  }}
                >
                  {/* Header */}
                  <div
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isSelected ? "16px" : 0, cursor: isSelected ? "pointer" : "inherit" }}
                    onClick={(e) => {
                      if (isSelected) {
                        e.stopPropagation();
                        setSelectedInterval(null);
                      }
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, overflow: "hidden" }}>
                      <div style={{ background: "#2a2a2a", padding: "4px 10px", borderRadius: "4px", fontSize: "12px", fontWeight: "700", color: "#ddd", flexShrink: 0 }}>
                        Feedback #{i + 1}
                      </div>

                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <span style={{ fontSize: "14px", color: "#666" }}>{isSelected ? "▲" : "▼"}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(`Feedback #${i + 1} Are you sure you want to delete this item? This action cannot be undone.`)) {
                            deleteInterval(i);
                          }
                        }}
                        style={{ background: "transparent", border: "none", color: "#666", fontSize: "16px", fontWeight: "bold", cursor: "pointer", outline: "none", padding: "0 4px" }}
                        onMouseOver={e => e.target.style.color = "#f87171"}
                        onMouseOut={e => e.target.style.color = "#666"}
                      >
                        ×
                      </button>
                    </div>
                  </div>

                  {isSelected && (
                    <>
                      <div style={{ borderBottom: "1px solid #2a2a2a", margin: "0 -20px 16px -20px" }} />

                      {/* FEEDBACK RANGE */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "28px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          <span style={{ fontSize: "14px", fontWeight: "600", color: "#fff", letterSpacing: "0.3px" }}>1. Select a range to give feedback on</span>
                        </div>
                        <div>
                          {!intv.isFullRange && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleReplayFromBase(intv);
                              }}
                              style={{
                                background: "#111",
                                color: "#ddd",
                                border: "1px solid #333",
                                borderRadius: "4px",
                                padding: "4px 8px",
                                fontSize: "11px",
                                fontWeight: "600",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: "4px",
                                transition: "all 0.2s"
                              }}
                              onMouseOver={e => { e.currentTarget.style.background = "#222"; e.currentTarget.style.borderColor = "#888"; e.currentTarget.style.color = "#fff"; }}
                              onMouseOut={e => { e.currentTarget.style.background = "#111"; e.currentTarget.style.borderColor = "#333"; e.currentTarget.style.color = "#ddd"; }}
                            >
                              <span>▶</span> Replay segment
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Range Component */}
                      <div
                        style={{
                          marginBottom: "12px",
                          opacity: intv.isFullRange ? 0.3 : 1,
                          pointerEvents: intv.isFullRange ? "none" : "auto",
                          filter: intv.isFullRange ? "grayscale(100%)" : "none",
                          transition: "all 0.2s ease"
                        }}
                        onClick={(e) => {
                          if (intv.isFullRange) return;
                          e.stopPropagation();
                          if (!isSelected) {
                            setSelectedInterval({ index: i, ...intv });
                            handleReplayFromBase(intv);
                          }
                        }}
                      >
                        {(() => {
                          const baseMin = 0;
                          const baseMax = totalFrames > 0 ? totalFrames - 1 : 100;
                          const rangeSpan = Math.max(baseMax - baseMin, 1);
                          // Clamp start/end for slider values to prevent react-range errors
                          const boundedStart = Math.max(baseMin, Math.min(baseMax, startFrame));
                          const boundedEnd = Math.max(baseMin, Math.min(baseMax, endFrame));

                          return (
                            <Range
                              values={[boundedStart, boundedEnd]}
                              step={1}
                              min={baseMin}
                              max={baseMax}
                              onChange={(values) => {
                                handleOffsetEdit("startOffset", values[0] - baseFrame);
                                handleOffsetEdit("endOffset", values[1] - baseFrame);
                                // Preview frame during drag
                                if (values[0] !== boundedStart) {
                                  setFrameIndex(values[0]);
                                  setElapsed(values[0] * frameDuration);
                                  setIsPlaying(prev => { if (prev) pauseCountRef.current += 1; return false; });
                                } else if (values[1] !== boundedEnd) {
                                  setFrameIndex(values[1]);
                                  setElapsed(values[1] * frameDuration);
                                  setIsPlaying(prev => { if (prev) pauseCountRef.current += 1; return false; });
                                }
                              }}
                              onFinalChange={(values) => {
                                const newIntv = { ...intv, startOffset: values[0] - baseFrame, endOffset: values[1] - baseFrame };
                                handleReplayFromBase(newIntv);
                              }}
                              renderTrack={({ props, children }) => (
                                <div
                                  {...props}
                                  style={{
                                    ...props.style,
                                    height: "24px",
                                    width: "100%",
                                    borderRadius: "4px",
                                    background: "#000",
                                    border: "1px solid #333",
                                    position: "relative",
                                    display: "flex",
                                    alignItems: "flex-end",
                                    boxSizing: "border-box"
                                  }}
                                >
                                  {/* Ticks */}
                                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", alignItems: "flex-end", overflow: "hidden", borderRadius: "3px" }}>
                                    {[...Array(20)].map((_, idx) => (
                                      <div key={idx} style={{ flex: 1, borderRight: "1px solid #222", height: (idx + 1) % 5 === 0 ? "10px" : "4px" }} />
                                    ))}
                                  </div>

                                  {/* Highlight Block */}
                                  <div
                                    style={{
                                      position: "absolute",
                                      left: `${((boundedStart - baseMin) / rangeSpan) * 100}%`,
                                      width: `${((boundedEnd - boundedStart) / rangeSpan) * 100}%`,
                                      height: "100%",
                                      background: "rgba(252, 211, 77, 0.35)",
                                      borderRadius: "3px",
                                      zIndex: 1,
                                    }}
                                  />
                                  {/* Base frame marker (Caret Above) */}
                                  <div
                                    style={{
                                      position: "absolute",
                                      left: `${((baseFrame - baseMin) / rangeSpan) * 100}%`,
                                      top: "-12px",
                                      transform: "translateX(-50%)",
                                      zIndex: 10,
                                      color: "#fff",
                                      fontSize: "10px",
                                      textShadow: "0 1px 2px rgba(0,0,0,0.8)",
                                      pointerEvents: "none"
                                    }}
                                    title={`Base Frame: ${baseFrame}`}
                                  >
                                    ▼
                                  </div>
                                  {children}
                                </div>
                              )}
                              renderThumb={({ props }) => {
                                const { key, ...restProps } = props;
                                return (
                                  <div
                                    {...restProps}
                                    key={key}
                                    style={{
                                      ...restProps.style,
                                      height: "24px",
                                      width: "4px",
                                      borderRadius: "2px",
                                      background: "#ffffff",
                                      boxShadow: "0 0 4px rgba(0,0,0,0.5)",
                                      outline: "none",
                                      cursor: "grab",
                                      zIndex: 3
                                    }}
                                  />
                                );
                              }}
                            />
                          );
                        })()}
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "28px" }} onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={intv.isFullRange}
                          onChange={(e) => {
                            e.stopPropagation();
                            setIntervals(prev => {
                              const next = [...prev];
                              next[i] = { ...next[i], isFullRange: !next[i].isFullRange, lastModifiedAt: Date.now() };
                              return next;
                            });
                            if (isSelected) {
                              setSelectedInterval(prev => ({ ...prev, isFullRange: !intv.isFullRange }));
                            }
                          }}
                          id={`fullRangeCheckbox-${i}`}
                          style={{ width: "16px", height: "16px", accentColor: "#fcd34d", cursor: "pointer" }}
                        />
                        <label htmlFor={`fullRangeCheckbox-${i}`} style={{ fontSize: "13px", color: "#eee", cursor: "pointer", userSelect: "none" }}>
                          I can't specify a range for this feedback
                        </label>
                      </div>

                      {/* What feedback would you like to give?*/}
                      <div style={{ marginBottom: "28px" }}>
                        <div style={{ fontSize: "14px", fontWeight: "600", color: "#fff", letterSpacing: "0.3px", marginBottom: "10px" }}>
                          2. What feedback would you like to give?
                        </div>
                        <textarea
                          value={intv.reason || ""}
                          onChange={(e) => {
                            e.stopPropagation();
                            if (!isSelected) {
                              setSelectedInterval({ index: i, ...intv });
                              handleReplayFromBase(intv);
                            }
                            handleReasonChange(e.target.value);
                          }}
                          placeholder="Write your feedback here…."
                          style={{
                            width: "100%",
                            background: "transparent",
                            border: "1px solid #2a2a2a",
                            borderRadius: "8px",
                            padding: "12px",
                            color: "#ccc",
                            fontSize: "13px",
                            fontFamily: "inherit",
                            resize: "vertical",
                            minHeight: "80px",
                            boxSizing: "border-box",
                            outline: "none"
                          }}
                          onClick={e => e.stopPropagation()}
                        />
                      </div>

                      {/* Why are you giving this feedback? */}
                      <div style={{ marginBottom: "28px" }}>
                        <div style={{ fontSize: "14px", fontWeight: "600", color: "#fff", letterSpacing: "0.3px", marginBottom: "10px" }}>
                          3. What is the reason for this feedback?
                        </div>
                        <textarea
                          value={intv.correction || ""}
                          onChange={(e) => {
                            e.stopPropagation();
                            if (!isSelected) {
                              setSelectedInterval({ index: i, ...intv });
                              handleReplayFromBase(intv);
                            }
                            handleCorrectionChange(e.target.value);
                          }}
                          placeholder="What made you think this…"
                          style={{
                            width: "100%",
                            background: "transparent",
                            border: "1px solid #2a2a2a",
                            borderRadius: "8px",
                            padding: "12px",
                            color: "#ccc",
                            fontSize: "13px",
                            fontFamily: "inherit",
                            resize: "vertical",
                            minHeight: "80px",
                            boxSizing: "border-box",
                            outline: "none"
                          }}
                          onClick={e => e.stopPropagation()}
                        />
                      </div>

                      {/* Sentiment Rating */}
                      <div>
                        <div style={{ fontSize: "14px", fontWeight: "600", color: "#fff", letterSpacing: "0.3px", marginBottom: "10px" }}>
                          4. How would you rate the tone of your feedback?
                        </div>
                        <div style={{ marginBottom: "16px", marginTop: "16px" }}>
                          <Range
                            values={[intv.sentiment || 3]}
                            step={1}
                            min={1}
                            max={5}
                            onChange={(values) => {
                              const newIntervals = [...intervals];
                              newIntervals[i].sentiment = values[0];
                              newIntervals[i].lastModifiedAt = Date.now();
                              setIntervals(newIntervals);
                            }}
                            renderTrack={({ props, children }) => (
                              <div
                                {...props}
                                style={{
                                  ...props.style,
                                  height: "4px",
                                  width: "100%",
                                  borderRadius: "2px",
                                  background: "#222",
                                  position: "relative",
                                }}
                              >
                                {/* Nodes (Slots) */}
                                {[1, 2, 3, 4, 5].map(val => (
                                  <div key={val} style={{
                                    position: "absolute",
                                    left: `${(val - 1) * 25}%`,
                                    top: "50%",
                                    transform: "translate(-50%, -50%)",
                                    width: "8px",
                                    height: "8px",
                                    background: "#333",
                                    borderRadius: "50%",
                                    zIndex: 1,
                                    border: "1px solid #1a1a1a"
                                  }} />
                                ))}
                                {children}
                              </div>
                            )}
                            renderThumb={({ props }) => {
                              const { key, ...restProps } = props;
                              return (
                                <div
                                  {...restProps}
                                  key={key}
                                  style={{
                                    ...restProps.style,
                                    height: "20px",
                                    width: "20px",
                                    borderRadius: "50%",
                                    background: "#fcd34d",
                                    border: "3px solid #111",
                                    boxShadow: "0 0 6px rgba(0,0,0,0.8)",
                                    boxSizing: "border-box",
                                    outline: "none",
                                    cursor: "grab",
                                    zIndex: 2,
                                  }}
                                />
                              );
                            }}
                          />
                        </div>
                        <div style={{ position: "relative", height: "14px", marginTop: "6px", fontSize: "11px", fontWeight: "600", color: "#666" }}>
                          <span style={{ position: "absolute", left: "0%" }}>Negative</span>
                          <span style={{ position: "absolute", left: "50%", transform: "translateX(-50%)" }}>Neutral</span>
                          <span style={{ position: "absolute", right: "0%" }}>Positive</span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
