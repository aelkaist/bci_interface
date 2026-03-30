import React, { useRef, useEffect, useState, useMemo } from "react";

export default function OvercookScene({ staticInfo, frame, frames, isReplaying }) {
  const gridSize = 80;
  const { grid, width, height } = staticInfo;

  // 애니메이션용 이전 프레임
  const prevFrameRef = useRef(frame);

  // 로직용 이전 프레임 fake object 계산용
  const prevLogicFrameRef = useRef(frame);

  const [interpProgress, setInterpProgress] = useState(1);

  // 스프라이트 데이터 로딩
  const [spritesData, setSpritesData] = useState(null);

  // 가짜 오브젝트 onion / soup 내려놓기 연출용
  const fakeObjectsRef = useRef([]);

  const [deliveryEffects, setDeliveryEffects] = useState([]);

  // 컴포넌트 마운트 시 스프라이트 시트 메타데이터 로드
  useEffect(() => {
    Promise.all([
      fetch('/graphics/chefs.json').then(r=>r.json()),
      fetch('/graphics/objects.json').then(r=>r.json()),
      fetch('/graphics/terrain.json').then(r=>r.json()),
      fetch('/graphics/soups.json').then(r=>r.json())
    ]).then(([chefs, objects, terrain, soups]) => {
      const parsedSprites = { chefs: {}, objects: {}, terrain: {}, soups: {} };
      
      const processFrames = (json, category) => {
        if (!json) return;
        if (json.frames && !Array.isArray(json.frames)) {
           Object.keys(json.frames).forEach(k => {
             parsedSprites[category][k] = json.frames[k];
           });
        }
      };

      processFrames(chefs, 'chefs');
      processFrames(objects, 'objects');
      processFrames(terrain, 'terrain');
      
      if (soups.textures && soups.textures[0] && soups.textures[0].frames) {
         soups.textures[0].frames.forEach(f => {
           parsedSprites.soups[f.filename] = f;
         });
      }
      setSpritesData(parsedSprites);
    }).catch(e => console.error("Sprite load error", e));
  }, []);

  // 플레이어 앞 방향 오프셋
  const dirOffset = {
    north: { dx: 0, dy: -1 },
    south: { dx: 0, dy: 1 },
    west: { dx: -1, dy: 0 },
    east: { dx: 1, dy: 0 },
  };

  // 리플레이로 들어갈 때 fake object만 초기화 (타이머는 순수 계산으로 처리)
  useEffect(() => {
    if (isReplaying) {
      fakeObjectsRef.current = [];
      prevLogicFrameRef.current = frame;
    }
  }, [isReplaying, frame]);

  // fake object 업데이트
  useEffect(() => {
    if (isReplaying) return;

    if (frame.timestep === 0) {
      fakeObjectsRef.current = [];
      prevLogicFrameRef.current = frame;
      return;
    }

    const prevFrame = prevLogicFrameRef.current;
    if (!prevFrame) {
      prevLogicFrameRef.current = frame;
      return;
    }

    let currentFake = [...fakeObjectsRef.current];

    frame.players.forEach((player, idx) => {
      const prevPlayer = prevFrame.players?.[idx];
      if (!prevPlayer) return;

      const prevHeld = prevPlayer.heldObject;
      const curHeld = player.heldObject;

      // 1 내려놓기
      if (prevHeld && !curHeld) {
        const name = prevHeld.name;
        if (name === "onion" || name === "soup" || name === "tomato" || name === "dish") {
          const ori = prevPlayer.orientation || "south";
          const { dx, dy } = dirOffset[ori] || { dx: 0, dy: 0 };

          const tx = prevPlayer.position.x + dx;
          const ty = prevPlayer.position.y + dy;

          if (tx >= 0 && tx < width && ty >= 0 && ty < height) {
            const cell = grid[ty][tx];

            // 오븐 배달대 위에는 안 만듦
            if (cell !== "P" && cell !== "S") {
              currentFake.push({
                id: `fake-${Date.now()}-${idx}-${name}`,
                name,
                position: { x: tx, y: ty },
              });
            }
          }
        }
      }

      // 2 집기
      if (!prevHeld && curHeld) {
        const name = curHeld.name;
        if (name === "onion" || name === "soup" || name === "tomato" || name === "dish") {
          const ori = prevPlayer.orientation || "south";
          const { dx, dy } = dirOffset[ori] || { dx: 0, dy: 0 };

          const tx = prevPlayer.position.x + dx;
          const ty = prevPlayer.position.y + dy;

          currentFake = currentFake.filter((obj) => {
            return !(obj.position.x === tx && obj.position.y === ty);
          });
        }
      }
    });

    fakeObjectsRef.current = currentFake;
    prevLogicFrameRef.current = frame;
  }, [frame, isReplaying, grid, width, height, dirOffset]);

  // 플레이어 이동 보간용
  useEffect(() => {
    setInterpProgress(0);
    let raf;
    let start;

    const animate = (time) => {
      if (!start) start = time;
      const elapsed = time - start;
      // 150ms 동안 부드럽게 이동하게 합니다.
      const progress = Math.min(elapsed / 150, 1);
      setInterpProgress(progress);
      if (progress < 1) {
        raf = requestAnimationFrame(animate);
      } else {
        prevFrameRef.current = frame;
      }
    };
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
    };
  }, [frame]);

  // 양파 요리 타이머 계산용
  const cookingRemainingByKey = useMemo(() => {
    const remainingByKey = {};
    if (!frames || frames.length === 0) return remainingByKey;

    frames.forEach((f) => {
      if (f.timestep > frame.timestep) return;

      const objectsFound = f.objects ? f.objects : [];
      let mappedObjects = objectsFound;
      
      const realObjects = Array.isArray(mappedObjects) ? mappedObjects : Object.values(mappedObjects || {});

      realObjects.forEach((obj) => {
        if (obj.name === "soup") {
          const count = obj.numIngredients ?? obj.ingredients?.length ?? 0;
          const isCooking = !obj.isReady && count >= 3;
          const key = `${obj.position.x} ${obj.position.y}`;
          const cookTotal = obj.cookTime ?? staticInfo.cookTime ?? 20;

          if (isCooking) {
            if (remainingByKey[key] === undefined) {
              remainingByKey[key] = cookTotal;
            } else if (remainingByKey[key] > 0) {
              remainingByKey[key] -= 1;
            }
          } else {
            remainingByKey[key] = obj.isReady ? 0 : cookTotal;
          }
        }
      });
    });

    return remainingByKey;
  }, [frames, frame, staticInfo.cookTime]);

  // 배달 카운트 파생 (스크러빙 시 버그 방지 - 각 프레임의 보상을 누적 합산)
  const deliveredCount = useMemo(() => {
     let sum = 0;
     if (frames) {
       for (let i = 0; i <= frame.timestep && i < frames.length; i++) {
          sum += (frames[i].score ?? 0);
       }
     }
     return Math.floor(sum / (staticInfo.deliveryReward ?? 20));
  }, [frame.timestep, frames, staticInfo.deliveryReward]);

  const prevDeliveredCountRef = useRef(deliveredCount);

  useEffect(() => {
    // 플레이어가 실제로 전진하는 중이면서 배달 수가 증가했을 때만 효과 발생
    if (deliveredCount > prevDeliveredCountRef.current && frame.timestep !== 0) {
      const diff = deliveredCount - prevDeliveredCountRef.current;
      const effectId = Date.now() + Math.random();
      setDeliveryEffects(prev => [...prev, { id: effectId, count: diff }]);
      
      // 애니메이션 재생 후 클린업
      setTimeout(() => {
        setDeliveryEffects(prev => prev.filter(e => e.id !== effectId));
      }, 1200);
    }
    prevDeliveredCountRef.current = deliveredCount;
  }, [deliveredCount, frame.timestep]);

  // 바닥 타일 맵핑
  const tileMap = useMemo(() => ({
    "X": "counter.png",
    " ": "floor.png",
    "P": "pot.png",
    "S": "serve.png",
    "O": "onions.png",
    "D": "dishes.png",
    "T": "tomatoes.png"
  }), []);

  const SOURCE_SIZES = {
    chefs: { w: 119, h: 119 },
    objects: { w: 255, h: 17 },
    terrain: { w: 119, h: 17 },
    soups: { w: 405, h: 15 },
  };

  const serveTiles = useMemo(() => {
    const tiles = [];
    grid.forEach((row, y) => {
      [...row].forEach((cell, x) => {
         if (cell === 'S') tiles.push({ x, y });
      });
    });
    return tiles;
  }, [grid]);

  const renderSprite = (category, frameName, x, y, size, opacity = 1) => {
    if (!spritesData || !spritesData[category]) return null;
    let data = spritesData[category][frameName];

    if (!data) {
      if (category === "chefs") {
        const fallbackHat = frameName.includes("greenhat") ? "SOUTH-greenhat.png" : "SOUTH-bluehat.png";
        data = spritesData[category][fallbackHat] || spritesData[category]["SOUTH.png"];
        if (!data) return null;
      } else {
        return null; // missing object sprite
      }
    }

    const f = data.frame;
    const ss = data.spriteSourceSize || { x: 0, y: 0, w: f.w, h: f.h };
    const srcSize = data.sourceSize || { w: f.w, h: f.h };

    const scale = size / 15; 
    const drawW = f.w * scale;
    const drawH = f.h * scale;

    // spriteSourceSize의 비정상적인 offset 값을 무시합니다 (모자가 허공에 뜨는 문제 해결).
    const finalX = x;
    const finalY = y;

    const source = SOURCE_SIZES[category];
    return (
      <svg x={finalX} y={finalY} width={drawW} height={drawH} viewBox={`${f.x} ${f.y} ${f.w} ${f.h}`} opacity={opacity} style={{ overflow: "hidden" }}>
        <image href={`/graphics/${category}.png`} x="0" y="0" width={source.w} height={source.h} />
      </svg>
    );
  };

  const normalizeDir = (dir) => {
    if (!dir) return "SOUTH";
    const s = String(dir).toUpperCase().trim();
    if (["NORTH", "SOUTH", "EAST", "WEST"].includes(s)) return s;
    if (s === "UP" || s.includes("-1")) return "NORTH";     
    if (s === "DOWN" || s.includes("1")) return "SOUTH";    
    if (s === "RIGHT" || s.includes("1")) return "EAST";    
    if (s === "LEFT" || s.includes("-1")) return "WEST";    
    return "SOUTH";
  };

  const backgroundTiles = useMemo(
    () => {
      if (!spritesData) return null;
      return grid.map((row, y) =>
        row.map((cell, x) => {
          let frameName = tileMap[cell];
          if (!frameName) {
            frameName = "floor.png";
          }
          const isDispenser = ["P", "S", "O", "D"].includes(cell);

          return (
            <g key={`${x}-${y}`}>
              {/* 디스펜서 렌더링 전 카운터 바닥 깔아주기 */}
              {isDispenser && renderSprite('terrain', 'counter.png', x * gridSize, y * gridSize, gridSize)}
              {renderSprite('terrain', frameName, x * gridSize, y * gridSize, gridSize)}
            </g>
          );
        })
      );
    },
    [grid, spritesData, tileMap]
  );

  const isHeldByPlayer = (obj) => {
    return frame.players.some((p) => {
      const h = p.heldObject;
      if (!h) return false;
      return (
        h.name === obj.name &&
        h.position?.x === obj.position.x &&
        h.position?.y === obj.position.y
      );
    });
  };

  const renderObject = (obj, i) => {
    if (isHeldByPlayer(obj)) {
      return null;
    }

    const { x, y } = obj.position;
    const cell = grid[y]?.[x];
    if (cell === "S") {
      return null;
    }

    let category = "objects";
    let frameName = `${obj.name}.png`; 
    
    if (obj.name === "tomato") {
       frameName = "tomato.png";
    }

    let remainingTime = null;
    let cooking = false;
    let cookTotalForBar = staticInfo.cookTime ?? 20;

    if (obj.name === "soup") {
      const isFakeSoup =
        obj.isCooking === undefined &&
        obj.isReady === undefined &&
        obj.numIngredients === undefined &&
        !Array.isArray(obj.ingredients);

      if (isFakeSoup) {
        frameName = "soup-onion-cooked.png";
      } else {
        const count = obj.numIngredients ?? obj.ingredients?.length ?? 0;
        const onionCount = Math.max(0, Math.min(3, count));

        const totalCookTime = obj.cookTime ?? staticInfo.cookTime ?? 20;
        cookTotalForBar = totalCookTime;

        const logicalCooking = !obj.isReady && onionCount >= 3;
        const logicalReady = obj.isReady && onionCount >= 3;

        if (logicalReady) {
          frameName = obj.ingredients?.includes("tomato") ? "soup-tomato-cooked.png" : "soup-onion-cooked.png";
        } else {
          if (onionCount === 0) {
            return null; // empty pot
          } else {
            const isTomato = obj.ingredients?.includes("tomato");
            frameName = `soup-${isTomato ? 'tomato' : 'onion'}-${onionCount}-cooking.png`;
          }
        }

        const key = `${x} ${y}`;
        const rem = cookingRemainingByKey[key];

        if (logicalCooking && typeof rem === "number") {
          remainingTime = rem;
          cooking = rem > 0;
        }
      }
    }

    const ready = obj.isReady;
    const barY = y * gridSize + 20;

    return (
      <g key={`obj-${i}`}>
        {renderSprite(category, frameName, x * gridSize, y * gridSize, gridSize, ready ? 1 : 0.85)}

        {cooking && remainingTime !== null && (
          <>
            <rect
              x={x * gridSize + 20}
              y={barY}
              width={40}
              height={6}
              rx={3}
              fill="#ff5555"
              opacity={0.85}
            />
            <rect
              x={x * gridSize + 20}
              y={barY}
              width={40 * (1 - remainingTime / cookTotalForBar)}
              height={6}
              rx={3}
              fill="#ffffff"
              opacity={0.9}
            />
            <text
              x={x * gridSize + gridSize / 2}
              y={barY - 4}
              textAnchor="middle"
              fontSize="12"
              fontFamily="monospace"
              fill="#ffffff"
            >
              {Math.ceil(remainingTime)}
            </text>
          </>
        )}
      </g>
    );
  };

  const renderPlayer = (player, index) => {
    const prevPlayer = prevFrameRef.current?.players?.[index] || player;

    const { x, y } = player.position;
    const prevX = prevPlayer.position?.x ?? x;
    const prevY = prevPlayer.position?.y ?? y;

    const interpX = lerp(prevX, x, interpProgress);
    const interpY = lerp(prevY, y, interpProgress);

    const scale = 1.0;
    const offset = (gridSize * (scale - 1)) / 2;

    const isInitialFrame = frame.timestep === 0;
    const rawOrientation = player.orientation || "south";
    const orientation = isInitialFrame ? "SOUTH" : normalizeDir(rawOrientation);

    const held = player.heldObject?.name;
    const heldLower = (held || "").toLowerCase();
    
    let frameName = null;
    let hatName = index === 0 ? `${orientation}-bluehat.png` : `${orientation}-greenhat.png`;
    
    if (heldLower === "onion") {
       frameName = `${orientation}-onion.png`;
    } else if (heldLower === "dish") {
       frameName = `${orientation}-dish.png`;
    } else if (heldLower.includes("soup")) {
       frameName = heldLower.includes("tomato") ? `${orientation}-soup-tomato.png` : `${orientation}-soup-onion.png`;
    } else if (heldLower === "tomato") {
       frameName = `${orientation}-tomato.png`;
    }

    return (
      <g
        key={player.id || index}
        transform={`translate(${interpX * gridSize - offset}, ${
          interpY * gridSize - offset
        }) scale(${scale})`}
      >
        {/* 기본 셰프 몸체 */}
        {renderSprite('chefs', `${orientation}.png`, 0, 0, gridSize)}
        {/* 들고 있는 물건 (몸체 앞/뒤/양손) */}
        {frameName && renderSprite('chefs', frameName, 0, 0, gridSize)}
        {/* 셰프 모자 (반드시 마지막에 그려야 함) */}
        {renderSprite('chefs', hatName, 0, 0, gridSize)}
      </g>
    );
  };

  const combinedObjects = isReplaying && fakeObjectsRef.current
    ? [...frame.objects, ...fakeObjectsRef.current]
    : [...frame.objects, ...fakeObjectsRef.current];

  if (!spritesData) {
    return (
      <div style={{ color: "#888", display: "flex", justifyContent: "center", alignItems: "center", width: "100%", height: "100%", fontSize: "18px" }}>
         Loading graphics assets...
      </div>
    );
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  return (
    <svg
      width={width * gridSize}
      height={height * gridSize}
      style={{
        border: "2px solid #999",
        background: "#d6c7a1",
        borderRadius: "8px",
        imageRendering: "pixelated",
        overflow: "visible"
      }}
    >
      {backgroundTiles}
      {combinedObjects.map((o, i) => renderObject(o, i))}
      {frame.players.map((p, i) => renderPlayer(p, i))}

      {/* 배달 팝업 이펙트 */}
      {deliveryEffects.map((eff, index) => {
         // Determine map size dynamically to prevent NaN default translations
         const mapW = staticInfo.width || (grid && grid[0] ? grid[0].length : 5);
         const mapH = staticInfo.height || (grid ? grid.length : 5);
         
         // 서빙타일 중 하나를 선택, 없으면 정중앙으로 (약간 번갈아가면서 나오도록 처리)
         let sTile = serveTiles.length > 0 ? serveTiles[index % serveTiles.length] : null;
         
         // If no serving tile 'S' is explicitly found, fallback to the physical center of the map
         if (!sTile) {
            sTile = { x: mapW / 2 - 0.5, y: mapH / 2 - 0.5 };
         }
         
         const tx = sTile.x * gridSize + gridSize / 2;
         const ty = sTile.y * gridSize - 15;

         return (
            <g key={eff.id} style={{ animation: "popSlideUp 1.2s ease-out forwards" }} transform={`translate(${tx}, ${ty})`}>
               <text textAnchor="middle" fill="#22c55e" fontSize="32" fontWeight="800" stroke="#052e16" strokeWidth="6" style={{ filter: "drop-shadow(0px 4px 6px rgba(0,0,0,0.5))" }}>
                  +{eff.count}
               </text>
               <text textAnchor="middle" fill="#4ade80" fontSize="32" fontWeight="800">
                  +{eff.count}
               </text>
            </g>
         );
      })}

      {!isReplaying && (
        <g transform="translate(10, 10)">
          <rect x={0} y={0} width={90} height={26} rx={8} ry={8} fill="rgba(0,0,0,0.6)" stroke="#ffffff" strokeWidth={1.5} />
          <text x={45} y={17} textAnchor="middle" fontSize="10" fontFamily="monospace" fill="#ffffff">Served {deliveredCount}</text>
        </g>
      )}

      {/* 팝업 이펙트용 스타일 정의 */}
      <style>{`
        @keyframes popSlideUp {
          0% { transform: translateY(0px) scale(0.5); opacity: 0; }
          15% { transform: translateY(-30px) scale(1.4); opacity: 1; }
          30% { transform: translateY(-25px) scale(1); opacity: 1; }
          80% { transform: translateY(-40px) scale(1); opacity: 1; }
          100% { transform: translateY(-50px) scale(0.9); opacity: 0; }
        }
      `}</style>
    </svg>
  );
}