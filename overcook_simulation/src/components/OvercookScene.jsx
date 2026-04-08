import React, { useRef, useEffect, useState, useMemo } from "react";

const CHEF_HAT_VARIANTS = [
  "bluehat",
  "greenhat",
  "orangehat",
  "purplehat",
  "redhat",
];

export default function OvercookScene({ staticInfo, frame, frames, isReplaying }) {
  const gridSize = 80;
  const { grid, width, height } = staticInfo;

  // 애니메이션용 이전 프레임
  const prevFrameRef = useRef(frame);

  // 로직용 이전 프레임 fake object 계산용
  const prevLogicFrameRef = useRef(frame);

  const [interpProgress, setInterpProgress] = useState(1);

  const [spritesData, setSpritesData] = useState(null);
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
  const dirOffset = useMemo(() => ({
    north: { dx: 0, dy: -1 },
    south: { dx: 0, dy: 1 },
    west: { dx: -1, dy: 0 },
    east: { dx: 1, dy: 0 },
  }), []);

  // 가짜 오브젝트 (Scrubbing 등 시차 이동 시 버그 방지를 위해 매번 완전 동기화)
  const fakeObjects = useMemo(() => {
    if (!frames || frame.timestep === 0) return [];

    let currentFake = [];

    // 0프레임부터 현재 프레임 전까지의 변경사항을 순차적으로 안전하게 재연
    for (let i = 1; i <= frame.timestep; i++) {
      const prevF = frames[i - 1];
      const curF = frames[i];
      if (!prevF || !curF) continue;

      curF.players.forEach((player, idx) => {
        const prevPlayer = prevF.players?.[idx];
        if (!prevPlayer) return;

        const prevHeld = prevPlayer.heldObject;
        const curHeld = player.heldObject;

        // 내려놓기
        if (prevHeld && !curHeld) {
          const name = prevHeld.name;
          if (name === "onion" || name === "soup" || name === "tomato" || name === "dish") {
            const ori = prevPlayer.orientation || "south";
            const { dx, dy } = dirOffset[ori] || { dx: 0, dy: 0 };
            const tx = prevPlayer.position.x + dx;
            const ty = prevPlayer.position.y + dy;

            if (tx >= 0 && tx < width && ty >= 0 && ty < height) {
              const cell = grid[ty][tx];
              if (cell !== "P" && cell !== "S") {
                currentFake.push({
                  id: `fake-${i}-${idx}-${name}`,
                  name,
                  position: { x: tx, y: ty },
                });
              }
            }
          }
        }

        // 집기
        if (!prevHeld && curHeld) {
          const name = curHeld.name;
          if (name === "onion" || name === "soup" || name === "tomato" || name === "dish") {
            const ori = prevPlayer.orientation || "south";
            const { dx, dy } = dirOffset[ori] || { dx: 0, dy: 0 };
            const tx = prevPlayer.position.x + dx;
            const ty = prevPlayer.position.y + dy;

            currentFake = currentFake.filter(
              (obj) => !(obj.position.x === tx && obj.position.y === ty)
            );
          }
        }
      });
    }

    return currentFake;
  }, [frame.timestep, frames, grid, width, height, dirOffset]);


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

  const deliveryReward = Math.max(1, staticInfo.deliveryReward ?? 20);
  const currentScore = Number(frame.score ?? 0);
  const previousScore = Number(
    frame.timestep > 0 ? frames?.[frame.timestep - 1]?.score ?? 0 : 0
  );
  const deliveredCount = useMemo(
    () => Math.floor(currentScore / deliveryReward),
    [currentScore, deliveryReward]
  );
  const deliveredThisFrame = useMemo(
    () => Math.max(0, Math.floor((currentScore - previousScore) / deliveryReward)),
    [currentScore, previousScore, deliveryReward]
  );
  const prevRenderedTimestepRef = useRef(frame.timestep);

  useEffect(() => {
    const steppedForwardOne = frame.timestep === prevRenderedTimestepRef.current + 1;

    // 현재 프레임에서 실제 배달 reward가 발생한 경우에만 효과를 재생합니다.
    if (steppedForwardOne && deliveredThisFrame > 0) {
      const effectId = Date.now() + Math.random();
      setDeliveryEffects(prev => [...prev, { id: effectId, count: deliveredThisFrame }]);
      
      // 애니메이션 재생 후 클린업
      setTimeout(() => {
        setDeliveryEffects(prev => prev.filter(e => e.id !== effectId));
      }, 1200);
    }
    prevRenderedTimestepRef.current = frame.timestep;
  }, [deliveredThisFrame, frame.timestep]);

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

  const serveLabelPositions = useMemo(() => {
    if (serveTiles.length === 0) {
      return [{ x: (width || 5) * gridSize / 2, y: (height || 5) * gridSize / 2 }];
    }

    return serveTiles.map((tile) => ({
      x: tile.x * gridSize + gridSize / 2,
      y: tile.y * gridSize + gridSize / 2,
    }));
  }, [serveTiles, gridSize, width, height]);

  const renderSprite = (category, frameName, x, y, size, opacity = 1) => {
    if (!spritesData || !spritesData[category]) return null;
    let data = spritesData[category][frameName];

    if (!data) {
      if (category === "chefs") {
        const hatMatch = frameName.match(/-(bluehat|greenhat|orangehat|purplehat|redhat)\.png$/);
        const fallbackHat = hatMatch ? `SOUTH-${hatMatch[1]}.png` : "SOUTH-bluehat.png";
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
      category = "soups";
      const count = obj.numIngredients ?? obj.ingredients?.length ?? 0;
      const ingredients = Array.isArray(obj.ingredients) ? obj.ingredients : Array(count).fill("onion");
      const onionCount = Math.max(0, Math.min(3, ingredients.filter(i => i === "onion").length));
      const tomatoCount = Math.max(0, Math.min(3, ingredients.filter(i => i === "tomato").length));

      const isReady = obj.isReady;
      const logicalCooking = !isReady && (onionCount + tomatoCount) >= 3;
      const isCooking = obj.isCooking !== undefined ? obj.isCooking : logicalCooking;

      const totalCookTime = obj.cookTime ?? staticInfo.cookTime ?? 20;
      cookTotalForBar = totalCookTime;

      let state = "idle";
      if (isReady) {
        state = "done";
      } else if (isCooking) {
        state = "cooked"; // The sprite files use 'cooked' when it is cooking, and 'done' when it's ready
      }

      if (onionCount === 0 && tomatoCount === 0) {
        return null; // Empty pot 
      }

      frameName = `soup_${state}_tomato_${tomatoCount}_onion_${onionCount}.png`;

      const key = `${x} ${y}`;
      const rem = cookingRemainingByKey[key];

      if (isCooking && typeof rem === "number") {
        remainingTime = rem;
        cooking = rem > 0;
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
    const hatVariant = CHEF_HAT_VARIANTS[index % CHEF_HAT_VARIANTS.length];
    const hatName = `${orientation}-${hatVariant}.png`;
    
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

  const combinedObjects = [...frame.objects, ...fakeObjects];

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
      viewBox={`0 0 ${width * gridSize} ${height * gridSize}`}
      style={{
        width: "100%",
        maxWidth: `${width * gridSize * 1.2}px`,
        height: "auto",
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
         const mapW = staticInfo.width || (grid && grid[0] ? grid[0].length : 5);
         const mapH = staticInfo.height || (grid ? grid.length : 5);
         
         let sTile = serveTiles.length > 0 ? serveTiles[index % serveTiles.length] : null;
         if (!sTile) {
            sTile = { x: mapW / 2 - 0.5, y: mapH / 2 - 0.5 };
         }
         
         const tx = sTile.x * gridSize + gridSize / 2;
         const ty = sTile.y * gridSize - 15;

         return (
            <g key={eff.id} transform={`translate(${tx}, ${ty})`}>
               <g style={{ animation: "popSlideUp 1.2s ease-out forwards" }}>
                  <text textAnchor="middle" fill="#4ade80" fontSize="20" fontWeight="bold">
                     +{eff.count}
                  </text>
               </g>
            </g>
         );
      })}

      {!isReplaying && serveLabelPositions.map((position, index) => (
        <g key={`served-label-${index}`} transform={`translate(${position.x}, ${position.y})`}>
          <text 
            x={0} 
            y={5} 
            textAnchor="middle" 
            fontSize="14" 
            fontWeight="bold" 
            fill="#ffffff"
          >
            Served: {deliveredCount}
          </text>
        </g>
      ))}

      {/* 팝업 이펙트용 스타일 정의 */}
      <style>{`
        @keyframes popSlideUp {
          0% { transform: translateY(0px); opacity: 0; }
          20% { transform: translateY(-15px); opacity: 1; }
          80% { transform: translateY(-25px); opacity: 1; }
          100% { transform: translateY(-30px); opacity: 0; }
        }
      `}</style>
    </svg>
  );
}
