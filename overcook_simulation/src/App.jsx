// src/App.jsx

import React, { useState, useEffect, useRef } from "react";
import OvercookScene from "./components/OvercookScene";
import { adaptEpisode } from "./data/overcook_episodes";
import { Range } from "react-range";

const MIN_OFFSET = -20;
const MAX_OFFSET = 20;
const FRAME_DURATION = 0.3;

// 시간 라벨 (필요하면 사용)
function baseTimeLabel(frame) {
  return `${(frame * FRAME_DURATION).toFixed(2)}s`;
}

export default function App() {
  const [instructionStep, setInstructionStep] = useState(0);
  const [hasReadInstructions, setHasReadInstructions] = useState(false);
  const [testSliderValue, setTestSliderValue] = useState([0]);
  
  // Quiz states
  const [quiz1Answer, setQuiz1Answer] = useState(null);
  const [quiz2Matches, setQuiz2Matches] = useState({});
  const [quiz3Order, setQuiz3Order] = useState(() => {
    // Initial shuffle
    let order = [1, 2, 3, 4];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
  });
  
  const [episode, setEpisode] = useState(null); // 업로드된 에피소드
  const [fileName, setFileName] = useState(""); // 업로드된 파일 이름

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
  const [playMode, setPlayMode] = useState("full"); // "full" | "segment"
  const [elapsed, setElapsed] = useState(0); // 초 단위 경과 시간
  const [playbackRate, setPlaybackRate] = useState(1); // 재생 배속

  const [intervals, setIntervals] = useState([]); // [{ baseFrame, startOffset, endOffset, reason }, ...]
  const [selectedInterval, setSelectedInterval] = useState(null);

  const [episodeCount, setEpisodeCount] = useState(1); // 에피소드 진행도 추적

  const rafRef = useRef(null);
  const segmentEndFrameRef = useRef(null); // 구간 재생 끝 프레임

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

        setElapsed(0);
        setFrameIndex(0);
        setIntervals([]);
        setSelectedInterval(null);
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

    const startTime = performance.now() - (elapsed * 1000) / playbackRate;

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
  }, [isPlaying, playMode, frameDuration, totalFrames, totalTime, elapsed, episode, playbackRate]);



  // 선택한 interval만 재생
  const handleReplayFromBase = (intv) => {
    if (!intv || !episode || totalFrames === 0) return;

    let startFrame = intv.baseFrame + intv.startOffset;
    let endFrame = intv.baseFrame + intv.endOffset;

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
    if (isPlaying) return;

    if (frameIndex >= totalFrames - 1) {
      setFrameIndex(0);
      setElapsed(0);
    }

    cancelAnimationFrame(rafRef.current);
    setPlayMode("full");
    setIsPlaying(true);
  };

  // 오프셋 편집
  const handleOffsetEdit = (field, value) => {
    if (!selectedInterval) return;

    const intValue = parseInt(value, 10);
    if (Number.isNaN(intValue)) return;

    const updated = [...intervals];
    updated[selectedInterval.index][field] = intValue;
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
    setIntervals(updated);

    setSelectedInterval((prev) => ({
      ...prev,
      reason: value,
    }));
  };

  // suggestion 편집
  const handleSuggestionChange = (value) => {
    if (!selectedInterval) return;

    const updated = [...intervals];
    updated[selectedInterval.index].suggestion = value;
    setIntervals(updated);

    setSelectedInterval((prev) => ({
      ...prev,
      suggestion: value,
    }));
  };

  const deleteInterval = (index) => {
    setIntervals((prev) => prev.filter((_, i) => i !== index));
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

  // 최종 export
  const handleExport = () => {
    if (!episode || totalFrames === 0) return;

    const calibratedData = intervals.map((intv) => {
      let calcStart = intv.baseFrame + intv.startOffset;
      let calcEnd = intv.baseFrame + intv.endOffset;

      if (calcStart > calcEnd) {
        const tmp = calcStart;
        calcStart = calcEnd;
        calcEnd = tmp;
      }

      calcStart = Math.max(calcStart, 0);
      calcEnd = Math.min(calcEnd, totalFrames - 1);

      return {
        baseFrame: intv.baseFrame,
        startFrame: calcStart,
        endFrame: calcEnd,
        reason: intv.reason || "",
        suggestion: intv.suggestion || "",
      };
    });

    const exportPayload = {
      originalFile: episode.fileName,
      calibratedCount: calibratedData.length,
      calibratedIntervals: calibratedData,
    };

    exportJSON(
      exportPayload,
      `calibrated_markers_${episode.fileName.replace(".json", "")}.json`
    );
  };

  const handleNextEpisode = () => {
    setEpisode(null);
    setIntervals([]);
    setSelectedInterval(null);
    setFrameIndex(0);
    setElapsed(0);
    setIsPlaying(false);
    setEpisodeCount((prev) => Math.min(prev + 1, 4));
  };

  // 메인 화면 (플레이스홀더 온보딩)
  if (instructionStep < 4) {
    let btnText = "Next";
    let isDisabled = false;
    let onNextClick = () => setInstructionStep(st => st + 1);

    if (instructionStep === 2) {
      const q1Correct = quiz1Answer === 4;
      const q2Correct = Object.keys(quiz2Matches).length === 5 && 
                        quiz2Matches.onion === "Onion" && 
                        quiz2Matches.pot === "Pot" && 
                        quiz2Matches.dish === "Dish" && 
                        quiz2Matches.chef === "AI Chef" && 
                        quiz2Matches.serve === "Serve";
      const q3Correct = quiz3Order.join("") === "1234";
      isDisabled = !(q1Correct && q2Correct && q3Correct);
    } else if (instructionStep === 3) {
      btnText = "Start Experiment";
      isDisabled = !hasReadInstructions;
    }

    return (
      <div style={{ height: instructionStep === 0 ? "100vh" : "auto", minHeight: "100vh", width: "100vw", background: "#0d0d0d", color: "#f0f0f0", display: "flex", flexDirection: "column", padding: instructionStep === 0 ? "30px 60px" : "40px 60px", boxSizing: "border-box", fontFamily: "Inter, sans-serif", overflowX: "hidden", overflowY: instructionStep === 0 ? "hidden" : "auto" }}>
        
        {/* 상단 헤더 컨테이너: Back/Next 네비게이션 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: instructionStep === 0 ? "20px" : "40px" }}>
          
          {/* 좌상단 BACK 버튼 */}
          <div style={{ visibility: instructionStep > 0 ? "visible" : "hidden" }}>
             <button
               onClick={() => setInstructionStep(st => Math.max(0, st - 1))}
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
            {btnText} {instructionStep < 3 && "→"}
          </button>
        </div>

        {/* 메인 콘텐츠 영역 (maxWidth 제한 해제) */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", width: "100%" }}>
          {instructionStep === 0 && (
             <div style={{ display: "flex", flexDirection: "column", gap: "40px" }}>
               <style>{`
                 @keyframes mouseMoveClick {
                   0% { transform: translate(60px, 60px) rotate(-15deg); opacity: 0; }
                   15% { opacity: 1; }
                   30% { transform: translate(0px, 0px) rotate(-15deg); }
                   40% { transform: translate(0px, 0px) rotate(-15deg) scale(0.8); }
                   50% { transform: translate(0px, 0px) rotate(-15deg) scale(1); }
                   70% { transform: translate(0px, 0px) rotate(-15deg); opacity: 1; }
                   85% { opacity: 0; }
                   100% { transform: translate(60px, 60px) rotate(-15deg); opacity: 0; }
                 }
                 @keyframes buttonClickMock {
                   0%, 35% { transform: scale(1); boxShadow: 0 0 28px rgba(252, 211, 77, 0.4); }
                   40% { transform: scale(0.94); boxShadow: 0 0 12px rgba(252, 211, 77, 0.8); background: #fde68a; }
                   45%, 100% { transform: scale(1); boxShadow: 0 0 28px rgba(252, 211, 77, 0.4); background: #fcd34d; }
                 }
               `}</style>
               <div>
                 <h1 style={{ fontSize: "40px", fontWeight: "800", margin: "0 0 12px 0" }}>Welcome to Our Experiment 👋</h1>
                 <p style={{ fontSize: "20px", color: "#aaa", margin: 0, lineHeight: 1.5 }}>
                   In this study, your task is to <strong style={{ color: "#fff" }}>watch AI chefs work together</strong> and <strong style={{ color: "#fff" }}>give feedback</strong> on their collaboration and mistakes.
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
                              <img src="/main.gif" alt="Gameplay preview" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.85 }} />
                              
                              {/* Pause Button Overlay */}
                              <div style={{ position: "absolute", width: "52px", height: "52px", borderRadius: "50%", background: "#22c55e", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 16px rgba(0,0,0,0.6)" }}>
                                 {/* Pause bars */}
                                 <div style={{ display: "flex", gap: "4px" }}>
                                    <div style={{ width: "4px", height: "14px", background: "#000", borderRadius: "2px" }} />
                                    <div style={{ width: "4px", height: "14px", background: "#000", borderRadius: "2px" }} />
                                 </div>
                              </div>
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
                        <p style={{ fontSize: "15px", color: "#999", margin: 0, lineHeight: 1.6 }}>You will observe <strong style={{color: "#ddd"}}>many chef agents collaborating</strong> in an Overcooked environment inspired by the Nintendo cooperative game.</p>
                     </div>

                     {/* Card 2 */}
                     <div style={{ flex: 1, background: "#111", border: "1px solid #222", borderRadius: "16px", padding: "40px 32px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", justifyContent: "center" }}>
                        
                        {/* Feedback UI Mockup Container */}
                        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "12px", marginBottom: "24px" }}>
                           {/* Sleek Dark Card */}
                           <div style={{ position: "relative", width: "100%", borderRadius: "8px", border: "1px solid #222", background: "#0a0a0c", aspectRatio: "2.5/1", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", flexShrink: 0 }}>
                              
                              <div style={{ background: "#18181b", padding: "30px", borderRadius: "16px", border: "1px solid #27272a", display: "flex", flexDirection: "column", alignItems: "center", gap: "24px", width: "80%", maxWidth: "280px", boxShadow: "0 10px 30px rgba(0,0,0,0.8)" }}>
                                 <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", width: "100%", opacity: 0.6 }}>
                                    <div style={{ width: "70%", height: "6px", background: "#3f3f46", borderRadius: "3px" }} />
                                    <div style={{ width: "45%", height: "6px", background: "#3f3f46", borderRadius: "3px" }} />
                                 </div>
                                 <div style={{
                                    background: "#fcd34d",
                                    color: "#18181b",
                                    padding: "10px 24px",
                                    borderRadius: "8px",
                                    fontSize: "15px",
                                    fontWeight: "700",
                                    position: "relative",
                                    animation: "buttonClickMock 3s ease-in-out infinite"
                                 }}>
                                    + Add Feedback
                                    {/* Fake Mouse Cursor Overlay */}
                                    <div style={{ 
                                        position: "absolute", 
                                        bottom: "-12px", right: "-8px", 
                                        width: "20px", height: "20px", 
                                        pointerEvents: "none", zIndex: 10,
                                        animation: "mouseMoveClick 3s ease-in-out infinite" 
                                    }}>
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: "drop-shadow(2px 4px 6px rgba(0,0,0,0.4))" }}>
                                          <path d="M5.5 3.5L18.5 10.5L12 13L15 20.5L11.5 22L8.5 14.5L3 17.5L5.5 3.5Z" fill="white" stroke="black" strokeWidth="1.5" strokeLinejoin="round"/>
                                        </svg>
                                    </div>
                                 </div>
                              </div>
                           </div>
                           
                           {/* Spacer to match Card 1's progress bar height */}
                           <div style={{ height: "16px", width: "100%" }} />
                        </div>

                        <h2 style={{ fontSize: "22px", fontWeight: "700", color: "#fff", margin: "0 0 16px 0", letterSpacing: "0.2px" }}>Give Feedback</h2>
                        <p style={{ fontSize: "15px", color: "#999", margin: 0, lineHeight: 1.6 }}>Whenever you notice them making <strong style={{color: "#ddd"}}>silly mistakes</strong>—or showing <strong style={{color: "#ddd"}}>great teamwork</strong>—just pause the video and write a quick comment!</p>
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
                    <p style={{ fontSize: "16px", color: "#aaa", margin: 0 }}><strong style={{color: "#fff"}}>To cook onion soup,</strong> you need:</p>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", fontSize: "15px", fontWeight: "600" }}>
                      
                      {/* Onions */}
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#0a0a0c", padding: "8px 14px", borderRadius: "8px", border: "1px solid #333" }}>
                        <div style={{ width: "15px", height: "15px", background: "url('/graphics/objects.png')", backgroundPosition: "-18px -1px", transform: "scale(1.2)", imageRendering: "pixelated" }} />
                        <span>Onions</span>
                      </div>
                      <span style={{ color: "#666", fontSize: "20px", transform: "translateY(1px)" }}>&rarr;</span>
                      
                      {/* Pot */}
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#0a0a0c", padding: "8px 14px", borderRadius: "8px", border: "1px solid #333" }}>
                        <div style={{ width: "15px", height: "15px", background: "url('/graphics/terrain.png')", backgroundPosition: "-86px -1px", transform: "scale(1.2)", imageRendering: "pixelated" }} />
                        <span>Pot</span>
                      </div>
                      <span style={{ color: "#666", fontSize: "20px", transform: "translateY(1px)" }}>&rarr;</span>
                      
                      {/* Wait */}
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#0a0a0c", padding: "8px 14px", borderRadius: "8px", border: "1px solid #333", color: "#fff" }}>
                        <span>⏳ Wait</span>
                      </div>
                      <span style={{ color: "#666", fontSize: "20px", transform: "translateY(1px)" }}>&rarr;</span>
                      
                      {/* Dish */}
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#0a0a0c", padding: "8px 14px", borderRadius: "8px", border: "1px solid #333" }}>
                        <div style={{ width: "15px", height: "15px", background: "url('/graphics/objects.png')", backgroundPosition: "-1px -1px", transform: "scale(1.2)", imageRendering: "pixelated" }} />
                        <span>Bring Dish</span>
                      </div>
                      <span style={{ color: "#666", fontSize: "20px", transform: "translateY(1px)" }}>&rarr;</span>
                      
                      {/* Serve */}
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#0a0a0c", padding: "8px 14px", borderRadius: "8px", border: "1px solid #333" }}>
                         <div style={{ width: "15px", height: "15px", background: "url('/graphics/terrain.png')", backgroundPosition: "-1px -1px", transform: "scale(1.2)", imageRendering: "pixelated" }} />
                         <span>Serve!</span>
                      </div>
                    </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px", width: "100%", marginTop: "12px" }}>
                  {[
                    { video: "/main.gif", title: "1. Pick up Onions", desc: "Grab onions from the supply", sprite: "url('/graphics/objects.png')", pos: "-18px -1px" },
                    { video: "/main.gif", title: "2. Put Onions in Pot", desc: "Place 3 onions in the pot to cook", sprite: "url('/graphics/terrain.png')", pos: "-86px -1px" },
                    { video: "/main.gif", title: "3. Grab a dish", desc: "Pick up a dish for serving", sprite: "url('/graphics/objects.png')", pos: "-1px -1px" },
                    { video: "/main.gif", title: "4. Serve the soup", desc: "Deliver finished soup to counter", sprite: "url('/graphics/terrain.png')", pos: "-1px -1px" }
                  ].map((item, i) => (
                    <div key={i} style={{ display: "flex", flexDirection: "column", background: "#1c1c1c", borderRadius: "14px", overflow: "hidden", border: "1px solid #333" }}>
                       <div style={{ width: "100%", height: "160px", background: "#000", borderBottom: "1px solid #333", display: "flex", alignItems: "center", justifyContent: "center", color: "#555", position: "relative" }}>
                         <img src={item.video} alt="Gameplay sequence preview" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.85 }} />
                         {/* Centered Decorative Asset overlay in the middle of video */}
                         <div style={{ position: "absolute", width: "40px", height: "40px", background: "rgba(0,0,0,0.6)", borderRadius: "50%", border: "1px solid #444", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(0,0,0,0.5)"}}>
                            <div style={{ width: "15px", height: "15px", background: item.sprite, backgroundPosition: item.pos, transform: "scale(1.5)", imageRendering: "pixelated" }} />
                         </div>
                       </div>
                       <div style={{ padding: "16px 20px" }}>
                         <strong style={{ fontSize: "15px", display: "block", marginBottom: item.desc ? "8px" : 0 }}>{item.title}</strong>
                         {item.desc && <p style={{ fontSize: "14px", color: "#aaa", margin: 0, lineHeight: 1.5 }}>{item.desc}</p>}
                       </div>
                    </div>
                  ))}
                </div>

                {/* Warning Message */}
                <div style={{ padding: "16px 20px", background: "#251a02", borderRadius: "8px", border: "1px solid #745103", display: "flex", alignItems: "center", gap: "12px", marginTop: "8px" }}>
                   <span style={{ fontSize: "20px", alignSelf: "flex-start", transform: "translateY(-1px)" }}>⚠️</span>
                   <p style={{ margin: 0, fontSize: "16px", color: "#fbbf24", lineHeight: 1.5 }}>It is really important that you know the rules of this game before you start. Please read <strong style={{ color: "#fcd34d" }}>"How the Kitchen Works"</strong> carefully.</p>
                </div>
             </div>
          )}

          {instructionStep === 2 && (
             <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                <h1 style={{ fontSize: "40px", fontWeight: "800", margin: 0 }}>Let's Check Your Understanding</h1>
                <p style={{ fontSize: "20px", color: "#aaa", margin: 0 }}>Watch the gameplay video below and answer all questions correctly to proceed.</p>
                
                {/* Reference Video Area (Responsive GIF) */}
                <div style={{ width: "100%", maxWidth: "800px", margin: "0 auto", backgroundColor: "#000", borderRadius: "14px", overflow: "hidden", border: "1px solid #333", display: "flex", alignItems: "center", justifyContent: "center", color: "#555", position: "relative", aspectRatio: "2.5/1", boxShadow: "0 10px 30px rgba(0,0,0,0.6)" }}>
                   <img src="/main.gif" alt="Gameplay preview" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.9 }} />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                   
                   {/* Quiz 1 */}
                   <div style={{ padding: "24px", background: "#1c1c1c", borderRadius: "12px", border: quiz1Answer === null ? "1px solid #333" : (quiz1Answer === 4 ? "1px solid #22c55e" : "1px solid #ef4444") }}>
                      <p style={{ fontSize: "16px", fontWeight: "600", margin: "0 0 16px 0", color: "#fff" }}>1. How many AI chefs do you see in the game?</p>
                      <div style={{ display: "flex", gap: "12px" }}>
                         {[1, 2, 3, 4].map(num => (
                            <button 
                               key={num}
                               onClick={() => setQuiz1Answer(num)}
                               style={{ padding: "10px 24px", fontSize: "16px", fontWeight: "700", borderRadius: "8px", border: quiz1Answer === num ? (num === 4 ? "1px solid #22c55e" : "1px solid #dc2626") : "1px solid #444", background: quiz1Answer === num ? (num === 4 ? "#22c55e" : "#ef4444") : "#2a2a2a", color: quiz1Answer === num ? (num === 4 ? "#000" : "#fff") : "#fff", cursor: "pointer", transition: "all 0.2s" }}
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
                            <p style={{ fontSize: "16px", fontWeight: "600", margin: "0 0 6px 0", color: "#fff" }}>2. Identify the names of the items</p>
                            <p style={{ fontSize: "14px", color: "#999", margin: 0 }}>Drag the property blocks below and drop them into the matching dashed boxes.</p>
                         </div>
                         <button 
                             onClick={() => setQuiz2Matches({})}
                             style={{ background: "transparent", border: "1px solid #444", color: "#aaa", padding: "6px 12px", borderRadius: "6px", cursor: "pointer", fontSize: "13px", display: "flex", alignItems: "center", gap: "6px", transition: "all 0.2s" }}
                             onMouseOver={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "#888"; }}
                             onMouseOut={(e) => { e.currentTarget.style.color = "#aaa"; e.currentTarget.style.borderColor = "#444"; }}
                             title="Reset matching answers"
                         >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                            Reset
                         </button>
                      </div>
                      
                      <div style={{ display: "flex", gap: "10px", marginBottom: "20px", flexWrap: "wrap", minHeight: "40px" }}>
                         {["Onion", "Pot", "Dish", "AI Chef", "Serve"].filter(word => !Object.values(quiz2Matches).includes(word)).map(word => (
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
                            { id: "onion", sprite: "url('/graphics/objects.png')", pos: "-18px -1px" },
                            { id: "pot", sprite: "url('/graphics/terrain.png')", pos: "-86px -1px" },
                            { id: "dish", sprite: "url('/graphics/objects.png')", pos: "-1px -1px" },
                            { id: "chef", sprite: "url('/graphics/chefs.png')", pos: "-1px -1px" },
                            { id: "serve", sprite: "url('/graphics/terrain.png')", pos: "-1px -1px" }
                         ].map(item => {
                            const match = quiz2Matches[item.id];
                            const isCorrect = (item.id === "onion" && match === "Onion") || 
                                              (item.id === "pot" && match === "Pot") ||
                                              (item.id === "dish" && match === "Dish") ||
                                              (item.id === "chef" && match === "AI Chef") ||
                                              (item.id === "serve" && match === "Serve");

                            return (
                               <div key={item.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                                  <div style={{ width: "60px", height: "60px", background: "#2a2a2a", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #444", boxShadow: "inset 0 4px 10px rgba(0,0,0,0.5)" }}>
                                     <div style={{ width: "15px", height: "15px", background: item.sprite, backgroundPosition: item.pos, transform: "scale(2.5)", imageRendering: "pixelated" }} />
                                  </div>
                                  <div 
                                     onDragOver={(e) => e.preventDefault()}
                                     onDrop={(e) => { e.preventDefault(); const data = e.dataTransfer.getData("text/plain"); if (data) setQuiz2Matches(prev => ({...prev, [item.id]: data})); }}
                                     onClick={() => { if (match) setQuiz2Matches(prev => { const newMatches = {...prev}; delete newMatches[item.id]; return newMatches; })}}
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
                   <div style={{ padding: "24px", background: "#1c1c1c", borderRadius: "12px", border: quiz3Order.join("") === "1234" ? "1px solid #22c55e" : "1px solid #333" }}>
                      <div style={{ marginBottom: "20px" }}>
                         <p style={{ fontSize: "16px", fontWeight: "600", margin: "0 0 6px 0", color: "#fff" }}>3. Arrange the cooking steps</p>
                         <p style={{ fontSize: "14px", color: "#999", margin: 0 }}>Drag the items up or down to place them in the correct sequential order.</p>
                      </div>
                      
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                         {quiz3Order.map((stepId, index) => {
                            const stepsMap = {
                               1: { text: "Pick up Onions", sprite: "url('/graphics/objects.png')", pos: "-18px -1px" },
                               2: { text: "Put Onions into the pot", sprite: "url('/graphics/terrain.png')", pos: "-86px -1px" },
                               3: { text: "Grab a dish", sprite: "url('/graphics/objects.png')", pos: "-1px -1px" },
                               4: { text: "Serve the soup", sprite: "url('/graphics/terrain.png')", pos: "-1px -1px" }
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
             <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                <style>{`
                  @keyframes sliderRange {
                    0%, 20% { left: 45%; right: 45%; }
                    40%, 60% { left: 15%; right: 45%; }
                    80%, 95% { left: 15%; right: 15%; }
                    100% { left: 45%; right: 45%; }
                  }
                  @keyframes sliderLeft {
                    0%, 20% { left: 45%; }
                    40%, 95% { left: 15%; }
                    100% { left: 45%; }
                  }
                  @keyframes sliderRight {
                    0%, 60% { right: 45%; }
                    80%, 95% { right: 15%; }
                    100% { right: 45%; }
                  }
                  @keyframes mouseLeftDrag {
                    0%, 10% { opacity: 0; transform: translate(15px, 15px) rotate(-15deg); }
                    15%, 45% { opacity: 1; transform: translate(0, 0) rotate(-15deg) scale(0.9); }
                    50%, 100% { opacity: 0; transform: translate(15px, 15px) rotate(-15deg); }
                  }
                  @keyframes mouseRightDrag {
                    0%, 50% { opacity: 0; transform: translate(15px, 15px) rotate(-15deg); }
                    55%, 85% { opacity: 1; transform: translate(0, 0) rotate(-15deg) scale(0.9); }
                    90%, 100% { opacity: 0; transform: translate(15px, 15px) rotate(-15deg); }
                  }
                  @keyframes mouseClick2 {
                    0% { transform: translate(60px, 60px) rotate(-15deg); opacity: 0; }
                    15% { opacity: 1; }
                    30%, 35% { transform: translate(0px, 0px) rotate(-15deg); }
                    40% { transform: translate(0px, 0px) rotate(-15deg) scale(0.8); }
                    50% { transform: translate(0px, 0px) rotate(-15deg) scale(1); }
                    70% { transform: translate(0px, 0px) rotate(-15deg); opacity: 1; }
                    85% { opacity: 0; }
                    100% { transform: translate(60px, 60px) rotate(-15deg); opacity: 0; }
                  }
                  @keyframes buttonClickMock2 {
                    0%, 35% { transform: scale(1); }
                    40% { transform: scale(0.94); background: #fde68a; }
                    45%, 100% { transform: scale(1); background: #fcd34d; }
                  }
                `}</style>

                <h1 style={{ fontSize: "40px", fontWeight: "800", margin: 0 }}>How to Add Feedback</h1>
                <p style={{ fontSize: "20px", color: "#aaa", margin: 0 }}>
                    While watching the video, <strong style={{ color: "#fff" }}>simply pause</strong> and follow these 3 steps to share your feedback on the AI chef's behavior.
                </p>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "24px", minHeight: "420px", marginTop: "12px" }}>
                   
                   {/* Card 1 */}
                   <div style={{ background: "#151515", borderRadius: "16px", padding: "24px", display: "flex", flexDirection: "column", justifyContent: "space-between", border: "1px solid #222" }}>
                      <div>
                         <div style={{ width: "32px", height: "32px", background: "#1c3e23", color: "#4ade80", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "800", fontSize: "16px", marginBottom: "20px" }}>1</div>
                         <strong style={{ fontSize: "18px", color: "#fff", display: "block", marginBottom: "12px" }}>Pause the Video</strong>
                         <p style={{ color: "#aaa", fontSize: "15px", lineHeight: "1.6", margin: 0 }}>Spot a behavior you'd like to comment on. Press pause to stop the playback.</p>
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
                         <p style={{ color: "#aaa", fontSize: "15px", lineHeight: "1.6", margin: 0 }}>Click the yellow button on the right panel to create a new feedback entry.</p>
                      </div>
                      <div style={{ boxSizing: "border-box", width: "100%", height: "120px", borderRadius: "10px", background: "#1c1c1c", border: "1px solid #2a2a2a", display: "flex", alignItems: "flex-end", padding: "16px", justifyContent: "center", marginTop: "30px" }}>
                          <div style={{ 
                              background: "#fcd34d", color: "#000", fontWeight: "700", border: "none", borderRadius: "8px", padding: "10px 24px", fontSize: "14px", display: "flex", alignItems: "center", gap: "6px", position: "relative",
                              animation: "buttonClickMock2 3s ease-in-out infinite"
                          }}>
                              <span>+</span> Add Feedback
                              {/* Fake Mouse Cursor Overlay */}
                              <div style={{ 
                                  position: "absolute", 
                                  bottom: "-12px", right: "-8px", 
                                  width: "20px", height: "20px", 
                                  pointerEvents: "none", zIndex: 10,
                                  animation: "mouseClick2 3s ease-in-out infinite" 
                              }}>
                                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: "drop-shadow(2px 4px 6px rgba(0,0,0,0.4))" }}>
                                    <path d="M5.5 3.5L18.5 10.5L12 13L15 20.5L11.5 22L8.5 14.5L3 17.5L5.5 3.5Z" fill="white" stroke="black" strokeWidth="1.5" strokeLinejoin="round"/>
                                  </svg>
                              </div>
                          </div>
                      </div>
                   </div>

                   {/* Card 3 */}
                   <div style={{ background: "#151515", borderRadius: "16px", padding: "24px", display: "flex", flexDirection: "column", justifyContent: "space-between", border: "1px solid #222" }}>
                      <div>
                         <div style={{ width: "32px", height: "32px", background: "#1c3e23", color: "#4ade80", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "800", fontSize: "16px", marginBottom: "20px" }}>3</div>
                         <strong style={{ fontSize: "18px", color: "#fff", display: "block", marginBottom: "12px" }}>Set Feedback Range & Comment</strong>
                         <p style={{ color: "#aaa", fontSize: "15px", lineHeight: "1.6", margin: 0 }}>Adjust the slider to highlight the exact frames and share your feedback</p>
                      </div>
                      <div style={{ boxSizing: "border-box", width: "100%", height: "120px", borderRadius: "10px", background: "#1c1c1c", border: "1px solid #2a2a2a", display: "flex", flexDirection: "column", padding: "20px", justifyContent: "center", marginTop: "30px", gap: "16px" }}>
                          {/* Range Slider Track */}
                          <div style={{ width: "100%", height: "4px", background: "#333", borderRadius: "2px", position: "relative" }}>
                               <div style={{ position: "absolute", height: "100%", background: "#fcd34d", borderRadius: "2px", animation: "sliderRange 4s ease-in-out infinite" }} />
                               <div style={{ position: "absolute", top: "50%", transform: "translate(-50%, -50%)", width: "12px", height: "12px", background: "#fff", borderRadius: "50%", boxShadow: "0 0 6px rgba(0,0,0,0.6)", animation: "sliderLeft 4s ease-in-out infinite" }}>
                                  <div style={{ position: "absolute", bottom: "-12px", right: "-8px", width: "18px", height: "18px", pointerEvents: "none", zIndex: 10, animation: "mouseLeftDrag 4s ease-in-out infinite" }}>
                                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: "drop-shadow(2px 4px 6px rgba(0,0,0,0.4))", width: "100%", height: "100%" }}>
                                        <path d="M5.5 3.5L18.5 10.5L12 13L15 20.5L11.5 22L8.5 14.5L3 17.5L5.5 3.5Z" fill="white" stroke="black" strokeWidth="1.5" strokeLinejoin="round"/>
                                      </svg>
                                  </div>
                               </div>
                               <div style={{ position: "absolute", top: "50%", transform: "translate(50%, -50%)", width: "12px", height: "12px", background: "#fff", borderRadius: "50%", boxShadow: "0 0 6px rgba(0,0,0,0.6)", animation: "sliderRight 4s ease-in-out infinite" }}>
                                  <div style={{ position: "absolute", bottom: "-12px", right: "-8px", width: "18px", height: "18px", pointerEvents: "none", zIndex: 10, animation: "mouseRightDrag 4s ease-in-out infinite" }}>
                                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: "drop-shadow(2px 4px 6px rgba(0,0,0,0.4))", width: "100%", height: "100%" }}>
                                        <path d="M5.5 3.5L18.5 10.5L12 13L15 20.5L11.5 22L8.5 14.5L3 17.5L5.5 3.5Z" fill="white" stroke="black" strokeWidth="1.5" strokeLinejoin="round"/>
                                      </svg>
                                  </div>
                               </div>
                          </div>
                          {/* Feedback Range Text */}
                          <div style={{ textAlign: "center", color: "#666", fontSize: "12px", fontWeight: "700", letterSpacing: "1px", marginTop: "4px" }}>
                             FEEDBACK RANGE
                          </div>
                      </div>
                   </div>

                </div>

                <div style={{ padding: "20px 24px", background: "#251a02", borderRadius: "12px", border: "1px solid #745103" }}>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "16px" }}>
                    <span style={{ fontSize: "20px" }}>⚠️</span>
                    <strong style={{ color: "#fcd34d", fontSize: "16px" }}>Important Notes</strong>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: "24px", color: "#fbbf24", fontSize: "15px", lineHeight: 1.6, display: "flex", flexDirection: "column", gap: "12px" }}>
                    <li><strong style={{ color: "#fcd34d" }}>Take your time:</strong> Pause and go back as needed.</li>
                    <li><strong style={{ color: "#fcd34d" }}>Finish what you start:</strong> Try to review the episode to the end in a single sitting.</li>
                  </ul>
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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100vw", background: "#0d0d0d", color: "#f0f0f0", overflow: "hidden", fontFamily: "Inter, sans-serif" }}>
      
      {/* Top Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 24px", borderBottom: "1px solid #1a1a1a", flexShrink: 0 }}>
         <div style={{ background: "#222", color: "#fcd34d", padding: "6px 16px", borderRadius: "6px", fontFamily: "monospace", fontSize: "15px", fontWeight: "700" }}>
            Episode {episodeCount} / 4
         </div>
         <div style={{ display: "flex", gap: "12px" }}>
             {!hasEpisode && (
                 <label style={{ background: "#4ade80", color: "#000", fontWeight: "700", padding: "8px 16px", borderRadius: "6px", cursor: "pointer", fontSize: "14px", border: "none" }}>
                    Upload JSON File
                    <input type="file" accept=".json" onChange={handleFileUpload} style={{ display: "none" }} />
                 </label>
             )}
             {hasEpisode && (
                 <button onClick={handleExport} style={{ background: "#1c1c1c", color: "#ccc", border: "1px solid #333", padding: "8px 16px", borderRadius: "6px", fontSize: "14px", cursor: "pointer", transition: "all 0.2s" }} onMouseOver={e=>e.target.style.background="#2a2a2a"} onMouseOut={e=>e.target.style.background="#1c1c1c"}>
                   📥 Export JSON
                 </button>
             )}
             <button onClick={handleNextEpisode} style={{ background: "#fcd34d", color: "#000", border: "none", padding: "8px 16px", borderRadius: "6px", fontSize: "14px", fontWeight: "700", cursor: "pointer", transition: "all 0.2s", display: "flex", alignItems: "center", gap: "6px" }} onMouseOver={e=>e.target.style.background="#fde68a"} onMouseOut={e=>e.target.style.background="#fcd34d"}>
               Next Scenario ➡
             </button>
         </div>
      </div>

      {/* Main Content Area */}
      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
        
        {/* Left Column (Canvas + Controls) */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
          
          {/* Main viewer (Canvas) */}
          <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", position: "relative", overflow: "hidden" }}>
          {frame ? (
            <div style={{ transform: "scale(1.2)", transformOrigin: "center" }}>
              <OvercookScene
                staticInfo={episode.staticInfo}
                frame={frame}
                frames={episode.frames}
                isReplaying={isReplaying}
              />
            </div>
          ) : (
            <div style={{ color: "#555", fontSize: "18px" }}>Please upload a JSON scenario to begin.</div>
          )}
          </div>

          {/* Bottom Control Bar */}
          <div
            style={{
              background: "#0a0a0a",
              borderTop: "1px solid #1a1a1a",
              padding: "16px 24px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              flexShrink: 0,
              zIndex: 10
            }}
          >
            {/* 하단 전체 Slider */}
            <input
              type="range"
              min={0}
              max={totalFrames > 0 ? totalFrames - 1 : 0}
              value={frameIndex}
              onChange={(e) => {
                const val = Number(e.target.value);
                setFrameIndex(val);
                setElapsed(val * frameDuration);
                setIsPlaying(false);
              }}
              disabled={!hasEpisode}
              style={{
                width: "100%",
                margin: 0,
                cursor: hasEpisode ? "pointer" : "default",
                accentColor: "#fcd34d"
              }}
            />

            {/* 컨트롤 Row */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
               {/* Left Info */}
               <div style={{ display: "flex", alignItems: "center", gap: "20px", color: "#888", fontSize: "12px", minWidth: "150px" }}>
                   <span>Frame {frameIndex} / <span style={{color: "#555"}}>{hasEpisode ? totalFrames - 1 : 0}</span></span>
                   <span>Time {(elapsed).toFixed(2)}s / <span style={{color: "#555"}}>{hasEpisode ? totalTime.toFixed(2) : "0.00"}s</span></span>
               </div>

               {/* Center Controls */}
               <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
                   <button onClick={() => { setFrameIndex(0); setElapsed(0); setIsPlaying(false); }} disabled={!hasEpisode} style={{ background: "transparent", border: "none", color: hasEpisode ? "#bbb" : "#444", cursor: hasEpisode ? "pointer" : "default", fontSize: "18px", transition: "color 0.2s", display: "flex", alignItems: "center", gap: "6px" }} onMouseOver={e=>{if(hasEpisode)e.currentTarget.style.color="#fff"}} onMouseOut={e=>{if(hasEpisode)e.currentTarget.style.color="#bbb"}}>
                     <span style={{ fontSize: "20px" }}>⏮</span>
                   </button>
                   <button onClick={() => { const target = Math.max(0, frameIndex - 1); setFrameIndex(target); setElapsed(target * frameDuration); setIsPlaying(false); }} disabled={!hasEpisode} style={{ background: "transparent", border: "none", color: hasEpisode ? "#bbb" : "#444", cursor: hasEpisode ? "pointer" : "default", fontSize: "18px", transition: "color 0.2s" }} onMouseOver={e=>{if(hasEpisode)e.currentTarget.style.color="#fff"}} onMouseOut={e=>{if(hasEpisode)e.currentTarget.style.color="#bbb"}}>◀</button>
                   <button onClick={togglePlay} disabled={!hasEpisode} style={{ background: hasEpisode ? "#fff" : "#1a1a1a", color: hasEpisode ? "#000" : "#444", border: "none", width: "48px", height: "48px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", cursor: hasEpisode ? "pointer" : "default", transition: "transform 0.1s" }} onMouseDown={e=>{if(hasEpisode)e.currentTarget.style.transform="scale(0.9)"}} onMouseUp={e=>{if(hasEpisode)e.currentTarget.style.transform="scale(1)"}}>
                      {isPlaying ? <span style={{fontSize: "20px", fontWeight: "900"}}>⏸</span> : <span style={{fontSize: "20px", marginLeft: "4px"}}>▶</span>}
                   </button>
                   <button onClick={() => { const target = Math.min(totalFrames - 1, frameIndex + 1); setFrameIndex(target); setElapsed(target * frameDuration); setIsPlaying(false); }} disabled={!hasEpisode} style={{ background: "transparent", border: "none", color: hasEpisode ? "#bbb" : "#444", cursor: hasEpisode ? "pointer" : "default", fontSize: "18px", transition: "color 0.2s" }} onMouseOver={e=>{if(hasEpisode)e.currentTarget.style.color="#fff"}} onMouseOut={e=>{if(hasEpisode)e.currentTarget.style.color="#bbb"}}>▶</button>
                   <button onClick={() => { const target = totalFrames > 0 ? totalFrames - 1 : 0; setFrameIndex(target); setElapsed(target * frameDuration); setIsPlaying(false); }} disabled={!hasEpisode} style={{ background: "transparent", border: "none", color: hasEpisode ? "#bbb" : "#444", cursor: hasEpisode ? "pointer" : "default", fontSize: "18px", transition: "color 0.2s" }} onMouseOver={e=>{if(hasEpisode)e.currentTarget.style.color="#fff"}} onMouseOut={e=>{if(hasEpisode)e.currentTarget.style.color="#bbb"}}>⏭</button>
               </div>

               {/* Right Controls */}
               <div style={{ minWidth: "150px", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "16px" }}>
                   <select
                     value={playbackRate}
                     onChange={(e) => setPlaybackRate(Number(e.target.value))}
                     disabled={!hasEpisode}
                     style={{
                       background: hasEpisode ? "#222" : "#111",
                       color: hasEpisode ? "#eee" : "#555",
                       border: "1px solid #333",
                       padding: "4px 8px",
                       borderRadius: "4px",
                       fontSize: "12px",
                       cursor: hasEpisode ? "pointer" : "default",
                       outline: "none"
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

      {/* Right Panel */}
      <div
        style={{
          width: "440px",
          flexShrink: 0,
          borderLeft: "1px solid #1a1a1a",
          background: "#0d0d0d",
          padding: "20px",
          textAlign: "center",
          opacity: 1,
          pointerEvents: "auto",
          transition: "opacity 0.3s ease",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
            <h3 style={{ margin: 0, fontWeight: 700, fontSize: "18px", color: "#fff", display: "flex", alignItems: "center", gap: "8px" }}>
                Feedback 
                <span style={{ background: "#333", color: "#fff", padding: "2px 8px", borderRadius: "12px", fontSize: "13px", fontWeight: 600 }}>{intervals.length}</span>
            </h3>
            <div style={{ display: "flex", gap: "10px" }}>
                <button
                  onClick={() => {
                    if (window.confirm("Are you sure you want to clear all feedback?")) {
                      setIntervals([]);
                      setSelectedInterval(null);
                    }
                  }}
                  disabled={intervals.length === 0}
                  style={{
                    background: "transparent", color: intervals.length > 0 ? "#ef4444" : "#555", border: "1px solid", borderColor: intervals.length > 0 ? "#ef4444" : "#333", padding: "12px 16px", borderRadius: "8px", fontSize: "14px", fontWeight: "600", cursor: intervals.length > 0 ? "pointer" : "default", transition: "all 0.2s ease"
                  }}
                  onMouseOver={(e) => { if (intervals.length > 0) { e.currentTarget.style.background = "#ef4444"; e.currentTarget.style.color = "#fff"; } }}
                  onMouseOut={(e) => { if (intervals.length > 0) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#ef4444"; } }}
                >
                  Reset
                </button>
                <button
                    onClick={() => {
                      if (!episode || totalFrames === 0) return;
                      const targetFrame = frameIndex;
                      const newInterval = {
                      baseFrame: targetFrame,
                      startOffset: -2,
                      endOffset: 2,
                      reason: "",
                      data: [],
                    };
                    const newIntervals = [...intervals, newInterval];
                    setIntervals(newIntervals);
                    setSelectedInterval({ index: newIntervals.length - 1, ...newInterval });
                  }}
                  style={{
                    background: "#fcd34d", color: "#000", border: "none", padding: "12px 24px", borderRadius: "8px", fontSize: "16px", fontWeight: "800", cursor: "pointer", transition: "all 0.2s ease", boxShadow: "0 0 16px rgba(252, 211, 77, 0.2)"
                  }}
                  onMouseOver={(e) => { e.currentTarget.style.background = "#fde68a"; e.currentTarget.style.transform = "scale(1.03)"; e.currentTarget.style.boxShadow = "0 0 24px rgba(252, 211, 77, 0.4)"; }}
                  onMouseOut={(e) => { e.currentTarget.style.background = "#fcd34d"; e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 0 16px rgba(252, 211, 77, 0.2)"; }}
                >
                  + Add Feedback
                </button>
            </div>
        </div>
        
        {intervals.length === 0 ? (
           <div style={{ display: "flex", justifyContent: "center", alignItems: "center", marginTop: "60px" }}>
              <div style={{ background: "#18181b", padding: "40px 30px", borderRadius: "16px", border: "1px dashed #333", display: "flex", flexDirection: "column", alignItems: "center", gap: "20px", width: "100%", maxWidth: "340px" }}>
                <p style={{ color: "#888", fontSize: "15px", margin: 0, lineHeight: 1.5 }}>Find a frame in the video, then press<br/><strong style={{color:"#bbb"}}>+ Add Feedback</strong> to start marking.</p>
              </div>
           </div>
        ) : (
          <div
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
              let startFrame = baseFrame + intv.startOffset;
              let endFrame = baseFrame + intv.endOffset;

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
                    setSelectedInterval({ index: i, ...intv });
                    if (!isSelected) {
                        handleReplayFromBase(intv);
                    }
                  }}
                  style={{
                    border: isSelected ? "1px solid #333" : "1px solid #222",
                    borderRadius: "12px",
                    padding: "20px",
                    marginBottom: "16px",
                    background: isSelected ? "#151515" : "#111",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    textAlign: "left"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isSelected ? "20px" : "0" }}>
                     <div style={{ background: "#333", color: "#fff", padding: "6px 12px", borderRadius: "6px", fontSize: "14px", fontWeight: "700" }}>
                        Feedback #{i + 1}
                     </div>
                     <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                         {!isSelected && (
                             <span style={{ color: "#aaa", fontSize: "13px" }}>Frame {startFrame} → {endFrame}</span>
                         )}
                         <button onClick={(e) => { e.stopPropagation(); deleteInterval(i); }} style={{ background: "transparent", border: "none", color: "#888", cursor: "pointer", fontSize: "18px", transition: "color 0.2s" }} onMouseOver={(e) => e.target.style.color = "#fff"} onMouseOut={(e) => e.target.style.color = "#888"}>✖</button>
                     </div>
                  </div>

                  {isSelected && selectedInterval && (
                    <>
                      <div style={{ borderBottom: "1px solid #2a2a2a", margin: "0 -20px 20px -20px" }} />
                      
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                         <span style={{ color: "#888", fontSize: "12px", fontWeight: "700", letterSpacing: "1px" }}>FEEDBACK RANGE</span>
                         <span style={{ color: "#aaa", fontSize: "13px" }}>Frame {startFrame} → {endFrame}</span>
                      </div>
                      
                      {/* 오프셋 Range */}
                      <div style={{ padding: "0 10px", marginBottom: "16px" }}>
                          <Range
                            values={[
                              selectedInterval.startOffset,
                              selectedInterval.endOffset,
                            ]}
                            step={1}
                            min={MIN_OFFSET}
                            max={MAX_OFFSET}
                            onChange={(values) => {
                              handleOffsetEdit("startOffset", values[0]);
                              handleOffsetEdit("endOffset", values[1]);
                            }}
                            renderTrack={({ props, children }) => (
                              <div
                                {...props}
                                style={{
                                  ...props.style,
                                  height: "6px",
                                  width: "100%",
                                  borderRadius: "3px",
                                  background: "#333",
                                  position: "relative",
                                }}
                              >
                                {/* 선택된 구간 하이라이트 */}
                                <div
                                  style={{
                                    position: "absolute",
                                    left: `${
                                      ((selectedInterval.startOffset -
                                        MIN_OFFSET) /
                                        (MAX_OFFSET - MIN_OFFSET)) *
                                      100
                                    }%`,
                                    width: `${
                                      ((selectedInterval.endOffset -
                                        selectedInterval.startOffset) /
                                        (MAX_OFFSET - MIN_OFFSET)) *
                                      100
                                    }%`,
                                    height: "100%",
                                    background: "#eab308",
                                    borderRadius: "3px",
                                  }}
                                />
                                {/* baseFrame(실시간 마킹 시점) 표시: offset 0 위치 */}
                                <div
                                  style={{
                                    position: "absolute",
                                    top: "-3px",
                                    left: `${
                                      ((0 - MIN_OFFSET) /
                                        (MAX_OFFSET - MIN_OFFSET)) *
                                      100
                                    }%`,
                                    width: "2px",
                                    height: "12px",
                                    background: "#888",
                                    transform: "translateX(-50%)",
                                  }}
                                />
                                {children}
                              </div>
                            )}
                            renderThumb={({ props }) => (
                              <div
                                {...props}
                                style={{
                                  ...props.style,
                                  height: "16px",
                                  width: "16px",
                                  borderRadius: "50%",
                                  background: "#ffffff",
                                  boxShadow: "0 0 6px rgba(0,0,0,0.5)",
                                }}
                              />
                            )}
                          />
                      </div>
                      
                      {/* Replay 버튼 */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReplayFromBase(selectedInterval);
                        }}
                        style={{
                          width: "100%",
                          background: "#0a0a0a",
                          border: "1px solid #222",
                          padding: "12px",
                          borderRadius: "8px",
                          color: "#fff",
                          fontWeight: "600",
                          fontSize: "14px",
                          cursor: "pointer",
                          transition: "background 0.2s"
                        }}
                        onMouseOver={(e) => e.target.style.background = "#1a1a1a"}
                        onMouseOut={(e) => e.target.style.background = "#0a0a0a"}
                      >
                        ▶ Replay
                      </button>

                      {/* Reason Input */}
                      <div style={{ marginTop: "24px" }}>
                          <div style={{ color: "#888", fontSize: "12px", fontWeight: "700", letterSpacing: "1px", marginBottom: "8px" }}>WHAT BEHAVIOR NEEDS FEEDBACK?</div>
                          <textarea
                            value={selectedInterval.reason || ""}
                            onChange={(e) => {
                              e.stopPropagation();
                              handleReasonChange(e.target.value);
                            }}
                            placeholder="e.g. The blue agent picked up an onion instead of a dish."
                            style={{
                              width: "100%",
                              minHeight: "80px",
                              padding: "12px",
                              background: "#0a0a0a",
                              border: "1px solid #222",
                              borderRadius: "8px",
                              color: "#eee",
                              fontFamily: "inherit",
                              fontSize: "14px",
                              resize: "vertical",
                              boxSizing: "border-box",
                              outline: "none"
                            }}
                            onFocus={(e) => e.target.style.border = "1px solid #555"}
                            onBlur={(e) => e.target.style.border = "1px solid #222"}
                          />
                      </div>

                      {/* Suggestion Input */}
                      <div style={{ marginTop: "20px" }}>
                          <div style={{ color: "#888", fontSize: "12px", fontWeight: "700", letterSpacing: "1px", marginBottom: "8px" }}>WHAT SHOULD THE AGENT DO INSTEAD?</div>
                          <textarea
                            value={selectedInterval.suggestion || ""}
                            onChange={(e) => {
                              e.stopPropagation();
                              handleSuggestionChange(e.target.value);
                            }}
                            placeholder="e.g. Pick up the dish first and move to the serving area."
                            style={{
                              width: "100%",
                              minHeight: "80px",
                              padding: "12px",
                              background: "#0a0a0a",
                              border: "1px solid #222",
                              borderRadius: "8px",
                              color: "#eee",
                              fontFamily: "inherit",
                              fontSize: "14px",
                              resize: "vertical",
                              boxSizing: "border-box",
                              outline: "none"
                            }}
                            onFocus={(e) => e.target.style.border = "1px solid #555"}
                            onBlur={(e) => e.target.style.border = "1px solid #222"}
                          />
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

    </div>
  );
}
