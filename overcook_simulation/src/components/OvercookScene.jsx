import React, { useRef, useEffect, useState, useMemo } from "react";

const CHEF_HAT_VARIANTS = [
  "bluehat",
  "greenhat",
  "orangehat",
  "purplehat",
  "redhat",
];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// Hold-then-snap easing: the agent stays at its current position
// for the first HOLD_RATIO of the frame, then moves quickly to the
// next position. This gives a deliberate, game-like "pause → move" feel.
// HOLD_RATIO: 0.0 = move immediately, 0.6 = wait a long time then snap.
const HOLD_RATIO = 0.4;

function snapEase(t) {
  if (t < HOLD_RATIO) return 0;
  const moved = (t - HOLD_RATIO) / (1 - HOLD_RATIO);
  // quick ease-out for the snap portion
  return 1 - (1 - moved) * (1 - moved);
}

export default function OvercookScene({
  staticInfo,
  frame,
  frames,
  frameIndex = null,
  elapsed = null,
  isReplaying,
  frameDuration = 0.3,
}) {
  const gridSize = 80;
  const { grid, width, height } = staticInfo;
  const sceneContainerRef = useRef(null);

  const [spritesData, setSpritesData] = useState(null);
  const [deliveryEffects, setDeliveryEffects] = useState([]);
  const [sceneBounds, setSceneBounds] = useState({ width: 0, height: 0 });

  // 컴포넌트 마운트 시 스프라이트 시트 메타데이터 로드
  useEffect(() => {
    Promise.all([
      fetch('/graphics/chefs.json').then(r => r.json()),
      fetch('/graphics/objects.json').then(r => r.json()),
      fetch('/graphics/terrain.json').then(r => r.json()),
      fetch('/graphics/soups.json').then(r => r.json())
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

  useEffect(() => {
    const container = sceneContainerRef.current;
    if (!container) return;

    const updateBounds = () => {
      const rect = container.getBoundingClientRect();
      setSceneBounds({
        width: rect.width,
        height: rect.height,
      });
    };

    updateBounds();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateBounds);
      return () => window.removeEventListener("resize", updateBounds);
    }

    const observer = new ResizeObserver(() => {
      updateBounds();
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

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
    const scale = size / 15;
    const drawW = f.w * scale;
    const drawH = f.h * scale;

    const source = SOURCE_SIZES[category];
    return (
      <svg
        x={x}
        y={y}
        width={drawW}
        height={drawH}
        viewBox={`0 0 ${f.w} ${f.h}`}
        opacity={opacity}
        style={{ overflow: "hidden", imageRendering: "pixelated" }}
      >
        <image
          href={`/graphics/${category}.png`}
          x={-f.x}
          y={-f.y}
          width={source.w}
          height={source.h}
          preserveAspectRatio="none"
        />
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

  // smartfactory 타일 스킨 매핑
  const smartfactoryTileMap = useMemo(() => ({
    "O": "/smartfactory/Assets-12.png",   // 양파 → Assets-12
    "D": "/smartfactory/Assets-11.png",   // 접시 → Assets-11
    "P": "/smartfactory/Assets-04.png",   // pot → Assets-04
    "S": "/smartfactory/Assets-08.png",   // serving area → Assets-08
  }), []);

  const backgroundTiles = useMemo(
    () => {
      if (!spritesData) return null;
      // 타일 간 서브픽셀 틈 제거용 (값 조절로 겹침 정도 변경)
      const tb = 1;
      return grid.map((row, y) =>
        row.map((cell, x) => {
          let frameName = tileMap[cell];
          if (!frameName) {
            frameName = "floor.png";
          }
          const isDispenser = ["P", "S", "O", "D"].includes(cell);
          const smartfactoryImage = smartfactoryTileMap[cell];

          // 맨 위 행 (y === 0): Assets-01로 교체
          if (y === 0) {
            return (
              <g key={`${x}-${y}`}>
                <image
                  href="/smartfactory/Assets-01.png"
                  x={x * gridSize - tb / 2}
                  y={y * gridSize - tb / 2}
                  width={gridSize + tb}
                  height={gridSize + tb}
                  preserveAspectRatio="xMidYMid slice"
                />
                {/* 디스펜서 타일이면 smartfactory 스킨 오버레이 */}
                {smartfactoryImage && (
                  <image
                    href={smartfactoryImage}
                    x={x * gridSize - tb / 2}
                    y={y * gridSize - tb / 2}
                    width={gridSize + tb}
                    height={gridSize + tb}
                    preserveAspectRatio="xMidYMid slice"
                  />
                )}
              </g>
            );
          }

          // 맨 아래 행: 디스펜서/팟 제외한 나머지를 Assets-05로 교체
          if (y === grid.length - 1 && !smartfactoryImage) {
            return (
              <g key={`${x}-${y}`}>
                <image
                  href="/smartfactory/Assets-05.png"
                  x={x * gridSize - tb / 2}
                  y={y * gridSize - tb / 2}
                  width={gridSize + tb}
                  height={gridSize + tb}
                  preserveAspectRatio="xMidYMid slice"
                />
              </g>
            );
          }

          // 맨 아래 행의 디스펜서/팟: Assets-05 배경 + smartfactory 오버레이
          if (y === grid.length - 1 && smartfactoryImage) {
            return (
              <g key={`${x}-${y}`}>
                <image
                  href="/smartfactory/Assets-05.png"
                  x={x * gridSize - tb / 2}
                  y={y * gridSize - tb / 2}
                  width={gridSize + tb}
                  height={gridSize + tb}
                  preserveAspectRatio="xMidYMid slice"
                />
                <image
                  href={smartfactoryImage}
                  x={x * gridSize - tb / 2}
                  y={y * gridSize - tb / 2}
                  width={gridSize + tb}
                  height={gridSize + tb}
                  preserveAspectRatio="xMidYMid slice"
                />
              </g>
            );
          }

          // 왼쪽/오른쪽 벽 (가장자리 카운터): Assets-01로 교체
          if ((x === 0 || x === row.length - 1) && cell !== " ") {
            return (
              <g key={`${x}-${y}`}>
                <image
                  href="/smartfactory/Assets-01.png"
                  x={x * gridSize - tb / 2}
                  y={y * gridSize - tb / 2}
                  width={gridSize + tb}
                  height={gridSize + tb}
                  preserveAspectRatio="xMidYMid slice"
                />
                {smartfactoryImage && (
                  <image
                    href={smartfactoryImage}
                    x={x * gridSize - tb / 2}
                    y={y * gridSize - tb / 2}
                    width={gridSize + tb}
                    height={gridSize + tb}
                    preserveAspectRatio="xMidYMid slice"
                  />
                )}
              </g>
            );
          }

          // smartfactory 스킨이 있는 타일 (양파, 접시, pot)
          if (smartfactoryImage) {
            return (
              <g key={`${x}-${y}`}>
                {/* 카운터 바닥 먼저 깔기 */}
                {renderSprite('terrain', 'counter.png', x * gridSize, y * gridSize, gridSize)}
                <image
                  href={smartfactoryImage}
                  x={x * gridSize - tb / 2}
                  y={y * gridSize - tb / 2}
                  width={gridSize + tb}
                  height={gridSize + tb}
                  preserveAspectRatio="xMidYMid slice"
                />
              </g>
            );
          }

          // 바닥 타일 (걸어다니는 공간): smartfactory 스킨 적용
          // 코너는 Assets-06, 단독 가장자리는 Assets-02/03 사용
          if (cell === " ") {
            const leftCell = row[x - 1];
            const rightCell = row[x + 1];
            const aboveCell = grid[y - 1]?.[x];
            const belowCell = grid[y + 1]?.[x];

            const hasWallLeft = leftCell !== " ";
            const hasWallRight = rightCell !== " " || x === row.length - 1;
            const hasWallAbove = aboveCell !== " ";
            const hasWallBelow = belowCell !== " ";

            // 코너 감지 (인접한 두 벽이 만나는 곳)
            const hasCornerTL = hasWallAbove && hasWallLeft;
            const hasCornerTR = hasWallAbove && hasWallRight;
            const hasCornerBL = hasWallBelow && hasWallLeft;
            const hasCornerBR = hasWallBelow && hasWallRight;

            // 코너에 포함되지 않은 단독 가장자리
            const edgeTop = hasWallAbove && !hasCornerTL && !hasCornerTR;
            const edgeBottom = hasWallBelow && !hasCornerBL && !hasCornerBR;
            const edgeLeft = hasWallLeft && !hasCornerTL && !hasCornerBL;
            const edgeRight = hasWallRight && !hasCornerTR && !hasCornerBR;

            const edgeOpacity = 0.4;
            const edgeOverlays = [];

            // 코너 오버레이 (Assets-06 회전/반전)
            if (hasCornerTL) {
              edgeOverlays.push(
                <image key="ctl" href="/smartfactory/Assets-06.png"
                  x={x * gridSize} y={y * gridSize}
                  width={gridSize} height={gridSize}
                  preserveAspectRatio="xMidYMid slice"
                  opacity={edgeOpacity}
                />
              );
            }
            if (hasCornerTR) {
              edgeOverlays.push(
                <image key="ctr" href="/smartfactory/Assets-06.png"
                  x={x * gridSize} y={y * gridSize}
                  width={gridSize} height={gridSize}
                  preserveAspectRatio="xMidYMid slice"
                  opacity={edgeOpacity}
                  transform={`translate(${x * gridSize * 2 + gridSize}, 0) scale(-1, 1)`}
                />
              );
            }
            if (hasCornerBL) {
              edgeOverlays.push(
                <image key="cbl" href="/smartfactory/Assets-06.png"
                  x={x * gridSize} y={y * gridSize}
                  width={gridSize} height={gridSize}
                  preserveAspectRatio="xMidYMid slice"
                  opacity={edgeOpacity}
                  transform={`translate(0, ${y * gridSize * 2 + gridSize}) scale(1, -1)`}
                />
              );
            }
            if (hasCornerBR) {
              edgeOverlays.push(
                <image key="cbr" href="/smartfactory/Assets-06.png"
                  x={x * gridSize} y={y * gridSize}
                  width={gridSize} height={gridSize}
                  preserveAspectRatio="xMidYMid slice"
                  opacity={edgeOpacity}
                  transform={`translate(${x * gridSize * 2 + gridSize}, ${y * gridSize * 2 + gridSize}) scale(-1, -1)`}
                />
              );
            }

            // 단독 가장자리 오버레이 (코너에 포함되지 않은 면만)
            if (edgeTop) {
              edgeOverlays.push(
                <image key="top" href="/smartfactory/Assets-02.png"
                  x={x * gridSize} y={y * gridSize}
                  width={gridSize} height={gridSize}
                  preserveAspectRatio="xMidYMid slice"
                  opacity={edgeOpacity}
                />
              );
            }
            if (edgeBottom) {
              edgeOverlays.push(
                <image key="bottom" href="/smartfactory/Assets-02.png"
                  x={x * gridSize} y={y * gridSize}
                  width={gridSize} height={gridSize}
                  preserveAspectRatio="xMidYMid slice"
                  opacity={edgeOpacity}
                  transform={`translate(0, ${y * gridSize * 2 + gridSize}) scale(1, -1)`}
                />
              );
            }
            if (edgeLeft) {
              edgeOverlays.push(
                <image key="left" href="/smartfactory/Assets-03.png"
                  x={x * gridSize} y={y * gridSize}
                  width={gridSize} height={gridSize}
                  preserveAspectRatio="xMidYMid slice"
                  opacity={edgeOpacity}
                />
              );
            }
            if (edgeRight) {
              edgeOverlays.push(
                <image key="right" href="/smartfactory/Assets-03.png"
                  x={x * gridSize} y={y * gridSize}
                  width={gridSize} height={gridSize}
                  preserveAspectRatio="xMidYMid slice"
                  opacity={edgeOpacity}
                  transform={`translate(${x * gridSize * 2 + gridSize}, 0) scale(-1, 1)`}
                />
              );
            }

            return (
              <g key={`${x}-${y}`}>
                <image
                  href="/smartfactory/Assets-07.png"
                  x={x * gridSize - tb / 2}
                  y={y * gridSize - tb / 2}
                  width={gridSize + tb}
                  height={gridSize + tb}
                  preserveAspectRatio="xMidYMid slice"
                />
                {edgeOverlays}
              </g>
            );
          }

          return (
            <g key={`${x}-${y}`}>
              {/* 중간 갈색 카운터 타일 → Assets-01 */}
              {cell === "X" ? (
                <image
                  href="/smartfactory/Assets-01.png"
                  x={x * gridSize - tb / 2}
                  y={y * gridSize - tb / 2}
                  width={gridSize + tb}
                  height={gridSize + tb}
                  preserveAspectRatio="xMidYMid slice"
                />
              ) : (
                <>
                  {isDispenser && renderSprite('terrain', 'counter.png', x * gridSize, y * gridSize, gridSize)}
                  {renderSprite('terrain', frameName, x * gridSize, y * gridSize, gridSize)}
                </>
              )}
            </g>
          );
        })
      );
    },
    [grid, spritesData, tileMap, smartfactoryTileMap]
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

  const getObjectKey = (obj, fallbackIndex = 0) => {
    const pos = obj?.position;
    if (!pos) {
      return `obj-${obj?.name || "unknown"}-${fallbackIndex}`;
    }

    return `obj-${obj?.name || "unknown"}-${pos.x}-${pos.y}`;
  };

  const renderObject = (obj, objectKey) => {
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

    // pot 위의 soup인 경우 smartfactory 이미지로 교체
    if (obj.name === "soup" && cell === "P") {
      const count = obj.numIngredients ?? obj.ingredients?.length ?? 0;
      const isReady = obj.isReady;
      let smartfactorySoupImage;
      if (isReady) {
        smartfactorySoupImage = "/smartfactory/Assets-21.png"; // 완료
      } else if (count >= 3) {
        smartfactorySoupImage = "/smartfactory/Assets-24.png"; // 요리 중 (재료 3개)
      } else if (count === 2) {
        smartfactorySoupImage = "/smartfactory/Assets-23.png"; // 재료 2개
      } else {
        smartfactorySoupImage = "/smartfactory/Assets-22.png"; // 재료 1개
      }

      return (
        <g key={objectKey}>
          <image
            href={smartfactorySoupImage}
            x={x * gridSize}
            y={y * gridSize}
            width={gridSize}
            height={gridSize}
            preserveAspectRatio="xMidYMid slice"
            opacity={ready ? 1 : 0.85}
          />

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
    }

    // 카운터 위 양파/토마토 → smartfactory Assets-13
    // 카운터 위 접시(상자) → smartfactory Assets-11
    if ((obj.name === "onion" || obj.name === "tomato") && cell !== "P") {
      return (
        <g key={objectKey}>
          <image
            href="/smartfactory/Assets-13.png"
            x={x * gridSize}
            y={y * gridSize}
            width={gridSize}
            height={gridSize}
            preserveAspectRatio="xMidYMid slice"
          />
        </g>
      );
    }

    if (obj.name === "dish" && cell !== "P") {
      return (
        <g key={objectKey}>
          <image
            href="/smartfactory/Assets-11.png"
            x={x * gridSize}
            y={y * gridSize}
            width={gridSize}
            height={gridSize}
            preserveAspectRatio="xMidYMid slice"
          />
        </g>
      );
    }

    return (
      <g key={objectKey}>
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

  const frameArray = Array.isArray(frames) ? frames : [];
  const fallbackFrameIndex = Math.max(frameArray.indexOf(frame), 0);
  const resolvedFrameIndex =
    Number.isInteger(frameIndex) && frameIndex >= 0
      ? frameIndex
      : fallbackFrameIndex;
  const exactFramePosition =
    Number.isFinite(elapsed) && frameDuration > 0
      ? elapsed / frameDuration
      : resolvedFrameIndex;
  const maxFrameIndex = Math.max(frameArray.length - 1, 0);
  const clampedFramePosition = clamp(exactFramePosition, 0, maxFrameIndex);
  const playerSourceIndex = clamp(Math.floor(clampedFramePosition), 0, maxFrameIndex);
  const playerTargetIndex = Math.min(playerSourceIndex + 1, maxFrameIndex);
  const playerFrame = frameArray[playerSourceIndex] || frame;
  const playerTargetFrame = frameArray[playerTargetIndex] || playerFrame;
  const playerInterpolationProgress =
    playerTargetIndex !== playerSourceIndex
      ? snapEase(clamp(clampedFramePosition - playerSourceIndex, 0, 1))
      : 0;

  const getPlayerKey = (player, index) =>
    player?.id ?? player?.playerId ?? player?.name ?? `player-${index}`;

  const findTargetPlayer = (player, index) => {
    const playerKey = getPlayerKey(player, index);
    return (
      playerTargetFrame?.players?.find(
        (candidate, candidateIndex) =>
          getPlayerKey(candidate, candidateIndex) === playerKey
      ) ||
      playerTargetFrame?.players?.[index] ||
      player
    );
  };

  const renderPlayer = (player, index) => {
    const targetPlayer = findTargetPlayer(player, index);

    const { x, y } = player.position;
    const targetX = targetPlayer.position?.x ?? x;
    const targetY = targetPlayer.position?.y ?? y;
    const movementDistance = Math.abs(targetX - x) + Math.abs(targetY - y);
    const canInterpolateMove = movementDistance <= 1.01;
    const movementProgress = canInterpolateMove ? playerInterpolationProgress : 0;

    const interpX = lerp(x, targetX, movementProgress);
    const interpY = lerp(y, targetY, movementProgress);

    const scale = 1.0;
    const offset = (gridSize * (scale - 1)) / 2;

    const isInitialFrame = frame.timestep === 0;
    const orientationPlayer = movementProgress > 0.15 ? targetPlayer : player;
    const rawOrientation = orientationPlayer.orientation || player.orientation || "south";
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
    // 양파를 들고 있을 때 smartfactory 이미지로 교체
    const heldOnionSmartfactory = heldLower === "onion";

    // smartfactory 셰프 이미지 매핑
    // 에이전트별 색상: 0=빨강(16,29), 1=주황(17,30), 2=초록(18,31), 3=파랑(19,32)
    const sideColorAssets = [16, 17, 18, 19];
    const frontColorAssets = [29, 30, 31, 32];
    const colorIndex = index % sideColorAssets.length;

    let chefImage = "/smartfactory/Assets-15.png"; // 기본: 아래
    let chefFlip = "";
    let colorOverlay = `/smartfactory/Assets-${frontColorAssets[colorIndex]}.png`;
    let colorFlip = "";

    if (orientation === "WEST") {
      chefImage = "/smartfactory/Assets-09.png";
      colorOverlay = `/smartfactory/Assets-${sideColorAssets[colorIndex]}.png`;
    } else if (orientation === "EAST") {
      chefImage = "/smartfactory/Assets-09.png";
      chefFlip = `translate(${gridSize}, 0) scale(-1, 1)`;
      colorOverlay = `/smartfactory/Assets-${sideColorAssets[colorIndex]}.png`;
      colorFlip = `translate(${gridSize}, 0) scale(-1, 1)`;
    } else if (orientation === "NORTH") {
      chefImage = "/smartfactory/Assets-15.png";
      colorOverlay = `/smartfactory/Assets-${frontColorAssets[colorIndex]}.png`;
    } else if (orientation === "SOUTH") {
      chefImage = "/smartfactory/Assets-15.png";
      chefFlip = `translate(0, ${gridSize}) scale(1, -1)`;
      colorOverlay = `/smartfactory/Assets-${frontColorAssets[colorIndex]}.png`;
      colorFlip = `translate(0, ${gridSize}) scale(1, -1)`;
    }

    return (
      <g
        key={player.id || index}
        transform={`translate(${interpX * gridSize - offset}, ${interpY * gridSize - offset}) scale(${scale})`}
      >
        {/* smartfactory 셰프 이미지 */}
        <image
          href={chefImage}
          x={0}
          y={0}
          width={gridSize}
          height={gridSize}
          preserveAspectRatio="xMidYMid slice"
          transform={chefFlip || undefined}
          style={{ imageRendering: "auto" }}
        />
        {/* 에이전트별 색상 오버레이 */}
        <image
          href={colorOverlay}
          x={0}
          y={0}
          width={gridSize}
          height={gridSize}
          preserveAspectRatio="xMidYMid slice"
          transform={colorFlip || undefined}
          style={{ imageRendering: "auto" }}
        />
        {/* 들고 있는 물건 - smartfactory 이미지 */}
        {(() => {
          // 재료 (onion, tomato): side=28, front/back=27
          // 빈 박스 (dish): side=20, front/back=14
          // 완성품 (soup): side=25, front/back=26
          const isSideView = orientation === "WEST" || orientation === "EAST";
          let heldAsset = null;

          if (heldLower === "onion" || heldLower === "tomato") {
            heldAsset = isSideView ? "/smartfactory/Assets-28.png" : "/smartfactory/Assets-27.png";
          } else if (heldLower === "dish") {
            heldAsset = isSideView ? "/smartfactory/Assets-20.png" : "/smartfactory/Assets-14.png";
          } else if (heldLower.includes("soup")) {
            heldAsset = isSideView ? "/smartfactory/Assets-25.png" : "/smartfactory/Assets-26.png";
          }

          if (!heldAsset) return null;
          return (
            <image
              href={heldAsset}
              x={0}
              y={0}
              width={gridSize}
              height={gridSize}
              preserveAspectRatio="xMidYMid slice"
              transform={chefFlip || undefined}
              style={{ imageRendering: "auto" }}
            />
          );
        })()}
      </g>
    );
  };

  const combinedObjects = Array.isArray(frame.objects) ? frame.objects : [];
  const boardWidth = width * gridSize;
  const boardHeight = height * gridSize;
  const widthScale =
    sceneBounds.width > 0 ? sceneBounds.width / boardWidth : 1;
  const heightScale =
    sceneBounds.height > 0 ? sceneBounds.height / boardHeight : 1;
  const containScale = Math.min(widthScale, heightScale);
  const svgWidth = Math.max(1, Math.floor(boardWidth * containScale));
  const svgHeight = Math.max(1, Math.floor(boardHeight * containScale));

  if (!spritesData) {
    return (
      <div
        ref={sceneContainerRef}
        style={{
          color: "#888",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          width: "100%",
          height: "100%",
          minHeight: 0,
          fontSize: "18px",
        }}
      >
        Loading graphics assets...
      </div>
    );
  }

  return (
    <div
      ref={sceneContainerRef}
      style={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        minWidth: 0,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        overflow: "hidden",
      }}
    >
      <svg
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${boardWidth} ${boardHeight}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          flex: "0 0 auto",
          maxWidth: "100%",
          maxHeight: "100%",
          border: "2px solid #999",
          background: "#ece7e1",
          borderRadius: "8px",
          imageRendering: "pixelated",
          overflow: "visible"
        }}
      >
        <g style={{ filter: "brightness(0.80) contrast(1.2)" }}>
          {backgroundTiles}
          {combinedObjects.map((obj, index) => renderObject(obj, getObjectKey(obj, index)))}
        </g>
        {(playerFrame.players || []).map((p, i) => renderPlayer(p, i))}

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
            <foreignObject
              key={eff.id}
              x={tx - 50}
              y={ty - 40}
              width={100}
              height={50}
              style={{ overflow: "visible", pointerEvents: "none" }}
            >
              <div
                xmlns="http://www.w3.org/1999/xhtml"
                style={{
                  animation: "popSlideUp 1.2s ease-out forwards",
                  fontFamily: "Inter, sans-serif",
                  fontSize: "32px",
                  fontWeight: "800",
                  color: "#000",
                  textAlign: "center",
                  imageRendering: "auto",
                  lineHeight: "50px",
                }}
              >
                +{eff.count}
              </div>
            </foreignObject>
          );
        })}



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
    </div>
  );
}
