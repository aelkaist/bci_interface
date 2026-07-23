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


const HOLD_RATIO = 0.0;

function snapEase(t) {
  if (t < HOLD_RATIO) return 0;
  const moved = (t - HOLD_RATIO) / (1 - HOLD_RATIO);
  // linear (constant velocity): no per-cell accel/decel, so a
  // multi-cell walk stays perfectly smooth across frame boundaries
  return moved;
}

/*
 * ──────────────────────────────────────────────────────────────────────────
 * 맵 타일에 입혀지는 이미지를 여기서 한 번에 바꿉니다.
 * 각 항목의 파일명("Assets-XX.png")만 원하는 이미지로 교체하면 됩니다.
 *
 *  - 이미지 파일은 모두  public/smartfactory/  폴더 안에 있어야 합니다.
 *  - 파일명만 바꾸면 되고, 코드의 다른 부분은 건드릴 필요가 없습니다.
 *  - 새 이미지를 넣을 땐 같은 폴더에 넣고 아래 파일명만 그 이름으로 바꾸세요.
 * ════════════════════════════════════════════════════════════════════════ */
const SKIN_DIR = "/smartfactory";

/* ── 바닥 타일 전체 투명도 ────────────────────────────────────────────────
 * 1.0 = 원본 그대로, 0.0 = 완전 투명
 * 0.85 ~ 0.95 정도로 낮추면 타일 경계선(그리드 선)이 부드러워집니다.
 * ────────────────────────────────────────────────────────────────────────── */
const FLOOR_TILE_OPACITY = 1.0;
const SHADOW_OPACITY = 0.45;       // 가장자리 그림자 타일 투명도 (0=투명, 1=불투명)
const FLOOR_BG_COLOR = "#b5a8a0";  // 바닥 타일 아래 깔리는 배경색 (타일 평균색에 맞추세요)

/* ── 타일 필터 설정 ─────────────────────────────────────────────────────────
 * brightness: 밝기 (1.0=원본, 0.8=어둡게, 1.2=밝게)
 * contrast:   대비 (1.0=원본, 1.3=높은 대비)
 * saturate:   채도 (1.0=원본, 0.8=파스텔, 1.3=선명)
 * ────────────────────────────────────────────────────────────────────────── */
const TILE_FILTER = "brightness(0.75) contrast(1.35) saturate(0.9)";
const OBJECT_FILTER = "brightness(0.80) contrast(1.2)";
const INGREDIENT_FILTER = "brightness(0.95) contrast(1.05)";
const POT_INGREDIENT_FILTER = "brightness(0.75) contrast(1.15)";
const HELD_INGREDIENT_FILTER = "brightness(0.83) contrast(1.10)";

const SKIN = {
  // ── 벽 / 카운터 ──────────────────────────────────────────────
  //wall: "Assets-01.png",        // 위쪽 벽, 좌우 벽, 중앙 카운터
  //wallBottom: "Assets-05.png",  // 아래쪽 벽

  // ── 바닥 (캐릭터가 걸어다니는 공간) ─────────────────────────
  //floor: "Assets-07.png",           // 바닥 기본 타일
  //floorEdgeTop: "Assets-02.png",    // 바닥 위쪽 가장자리(벽과 맞닿는 그림자)
  //floorEdgeBottom: "Assets-07.png", // 바닥 아래쪽 가장자리
  //floorEdgeSide: "Assets-03.png",   // 바닥 좌우 가장자리 그림자
  //floorCorner: "Assets-06.png",     // 바닥 코너 그림자
  //floorEdgeOpacity: 0.4,            // 가장자리 그림자 진하기 (0=투명, 1=불투명)

  // ── 설비 (맵 기호 → 이미지) ─────────────────────────────────
  station: {
    O: "Assets-55.png",  // 양파 공급기
    D: "Assets-11.png",  // 접시 공급기
    P: "Assets-103.png",  // 냄비 (pot)
    S: "drop6.png",  // 서빙대
  },

  // ── 냄비 조리 상태 (재료 개수/완료) ─────────────────────────
  pot: {
    mat1: "1mat.png",  // 재료 1개 오버레이
    mat2: "2mat.png",  // 재료 2개 오버레이
    mat3: "3mat.png",  // 재료 3개 오버레이 (조리 중)
    ready: "Assets-88.png", // 조리 완료
  },

  // ── 카운터 위에 놓인 물건 ───────────────────────────────────
  itemOnCounter: {
    ingredient: "material.png",  // 양파/토마토
    dish: "box only.png",         // 접시 (box_new)
  },

  // ── 셰프(에이전트) ──────────────────────────────────────────
  chef: {
    front: "agv2.png",  // 정면(위/아래를 볼 때)
    side: "agv.png",   // 측면(좌/우를 볼 때)
    // 에이전트별 색상 오버레이  [0=빨강, 1=주황, 2=초록, 3=파랑]
    frontColor: ["Assets-93.png", "Assets-94.png", "Assets-95.png", "Assets-96.png"],
    sideColor: ["Assets-89.png", "Assets-90.png", "Assets-91.png", "Assets-92.png"],
  },

  // ── 셰프가 들고 있는 물건 (front=정면, side=측면) ────────────
  held: {
    ingredientFront: "materialfront.png",  // 양파/토마토
    ingredientSide: "materialside.png",
    dishFront: "openboxfront.png",        // 빈 접시
    dishSide: "openboxside.png",
    soupFront: "boxfront.png",        // 완성 요리
    soupSide: "boxside.png",
  },
};

// SKIN 파일명을 실제 이미지 경로로 변환
const skinUrl = (name) => `${SKIN_DIR}/${name}`;

/* ══════════════════════════════════════════════════════════════════════════
 * 📍 좌표별 스킨 오버라이드
 * ──────────────────────────────────────────────────────────────────────────
 * 특정 칸을 자동 스킨 대신 원하는 이미지로 "콕 집어" 바꾸고 싶을 때 사용합니다.
 *
 *   - 키는 맵(레이아웃) 이름, 그 안에서 "x,y": "파일명" 형식으로 지정합니다.
 *   - x = 왼쪽에서부터(0시작), y = 위에서부터(0시작) 칸 번호입니다.
 *   - 여기 적힌 칸만 이 이미지로 덮어쓰고, 나머지는 자동(오토타일) 그대로입니다.
 *   - "_4" 버전 맵은 기본 맵과 격자가 같으므로 같은 표가 자동 적용됩니다.
 *
 * 예)  "2_forced_hard": { "6,3": "Assets-07.png" }
 *      → 2_forced_hard 맵의 x=6, y=3 칸을 Assets-07 로 교체
 * ════════════════════════════════════════════════════════════════════════ */
const SKIN_OVERRIDE = {
  "2_forced_hard": {
    "0,0": "Assets-01.png",
    "1,0": "Assets-01.png",
    "2,0": "Assets-01.png",
    "3,0": "Assets-01.png",
    "4,0": "Assets-01.png",
    "6,0": "Assets-01.png",
    "7,0": "Assets-01.png",
    "8,0": "Assets-01.png",
    "9,0": "Assets-01.png",
    "10,0": "Assets-01.png",
    "11,0": "Assets-01.png",
    "12,0": "Assets-01.png",
    "1,1": { file: "Assets-06.png", opacity: SHADOW_OPACITY },
    "2,1": { file: "Assets-02.png", opacity: SHADOW_OPACITY },
    "3,1": { file: "Assets-02.png", opacity: SHADOW_OPACITY },
    "4,1": { file: "Assets-02.png", opacity: SHADOW_OPACITY },
    "5,1": { file: "Assets-02.png", opacity: SHADOW_OPACITY },
    "6,1": "Assets-01.png",
    "7,1": { file: "Assets-02.png", opacity: SHADOW_OPACITY },
    "8,1": { file: "Assets-02.png", opacity: SHADOW_OPACITY },
    "9,1": { file: "Assets-02.png", opacity: SHADOW_OPACITY },
    "10,1": { file: "Assets-02.png", opacity: SHADOW_OPACITY },
    "11,1": { file: "Assets-06.png", flipX: true, opacity: SHADOW_OPACITY },
    "12,1": "Assets-01.png",
    "0,2": "Assets-01.png",
    "1,2": { file: "Assets-03.png", opacity: SHADOW_OPACITY },
    "2,2": "Assets-07.png",
    "3,2": "Assets-07.png",
    "4,2": "Assets-07.png",
    "5,2": "Assets-07.png",
    "6,2": "Assets-01.png",
    "7,2": "Assets-07.png",
    "8,2": "Assets-07.png",
    "9,2": "Assets-07.png",
    "10,2": "Assets-07.png",
    "11,2": { file: "Assets-03.png", flipX: true, opacity: SHADOW_OPACITY },


    "0,3": "Assets-01.png",
    "1,3": { file: "Assets-03.png", opacity: SHADOW_OPACITY },
    "12,2": "Assets-80.png",
    "11,3": { file: "Assets-03.png", flipX: true, opacity: SHADOW_OPACITY },

    "2,3": "Assets-07.png",
    "3,3": "Assets-07.png",
    "4,3": "Assets-07.png",
    "5,3": "Assets-07.png",
    "7,3": "Assets-07.png",
    "8,3": "Assets-07.png",
    "9,3": "Assets-07.png",
    "10,3": "Assets-07.png",

    "0,6": "Assets-45.png",
    "1,6": "Assets-45.png",
    "2,6": "Assets-45.png",
    "3,6": "Assets-45.png",
    "4,6": "Assets-45.png",
    "6,6": "Assets-45.png",
    "8,6": "Assets-45.png",
    "9,6": "Assets-45.png",
    "10,6": "Assets-45.png",
    "11,6": "Assets-45.png",
    "12,6": "Assets-45.png",

    "5,6": { file: "Assets-45.png", overlay: "box_new.png" },
    "5,5": "Assets-48.png",
    "0,5": { file: "Assets-38.png", overlay: "box_new.png" },
    "0,4": "Assets-01.png",
    "1,5": { file: "Assets-46.png", opacity: SHADOW_OPACITY, fullPart: { top: 0.85 } },

    "12,3": "Assets-79.png",
    "6,5": "Assets-38.png",
    "6,4": "Assets-40.png",
    "12,5": "Assets-38.png",
    "12,4": "Assets-40.png",
    "11,5": { file: "Assets-77.png", opacity: SHADOW_OPACITY, fullPart: { top: 0.85 } },

    "1,4": { file: "Assets-03.png", opacity: SHADOW_OPACITY },
    "2,4": "Assets-07.png",
    "3,4": "Assets-07.png",
    "4,4": "Assets-07.png",
    "5,4": "Assets-07.png",
    "7,4": "Assets-07.png",
    "8,4": "Assets-07.png",
    "9,4": "Assets-07.png",
    "10,4": "Assets-07.png",
    "11,4": { file: "Assets-03.png", flipX: true, opacity: SHADOW_OPACITY },

    "2,5": "Assets-48.png",
    "3,5": "Assets-48.png",
    "4,5": "Assets-48.png",
    "8,5": "Assets-48.png",
    "9,5": "Assets-48.png",
    "7,5": "Assets-82.png",

    //"7,6": "Assets-81.png",
    "10,5": "Assets-48.png",

  },
  "2_incentivized_hard": {
    "0,0": "Assets-01.png",
    "1,0": "Assets-01.png",
    "2,0": "Assets-01.png",
    "3,0": "Assets-01.png",
    "4,0": "Assets-01.png",
    "6,0": "Assets-01.png",
    "7,0": "Assets-01.png",
    "8,0": "Assets-01.png",
    "9,0": "Assets-01.png",
    "10,0": "Assets-01.png",
    "11,0": "Assets-01.png",
    "12,0": "Assets-01.png",
    "1,1": { file: "Assets-06.png", opacity: SHADOW_OPACITY },
    "2,1": { file: "Assets-02.png", opacity: SHADOW_OPACITY },
    "3,1": { file: "Assets-02.png", opacity: SHADOW_OPACITY },
    "4,1": { file: "Assets-02.png", opacity: SHADOW_OPACITY },
    "5,1": { file: "Assets-02.png", opacity: SHADOW_OPACITY },
    "6,1": { file: "Assets-02.png", opacity: SHADOW_OPACITY },
    "7,1": { file: "Assets-02.png", opacity: SHADOW_OPACITY },
    "8,1": { file: "Assets-02.png", opacity: SHADOW_OPACITY },
    "9,1": { file: "Assets-02.png", opacity: SHADOW_OPACITY },
    "10,1": { file: "Assets-02.png", opacity: SHADOW_OPACITY },
    "11,1": { file: "Assets-06.png", flipX: true, opacity: SHADOW_OPACITY },
    "12,1": "Assets-01.png",
    "0,2": "Assets-01.png",
    "1,2": { file: "Assets-03.png", opacity: SHADOW_OPACITY },
    "2,2": "Assets-07.png",
    "3,2": "Assets-07.png",
    "4,2": "Assets-07.png",
    "5,2": "Assets-07.png",
    "6,2": "Assets-01.png",
    "7,2": "Assets-07.png",
    "8,2": "Assets-07.png",
    "9,2": "Assets-07.png",
    "10,2": "Assets-07.png",
    "11,2": { file: "Assets-03.png", flipX: true, opacity: SHADOW_OPACITY },


    "0,3": "Assets-01.png",
    "1,3": { file: "Assets-03.png", opacity: SHADOW_OPACITY },
    "12,2": "Assets-80.png",
    "11,3": { file: "Assets-03.png", flipX: true, opacity: SHADOW_OPACITY },

    "2,3": "Assets-07.png",
    "3,3": "Assets-07.png",
    "4,3": "Assets-07.png",
    "5,3": "Assets-07.png",
    "7,3": "Assets-07.png",
    "8,3": "Assets-07.png",
    "9,3": "Assets-07.png",
    "10,3": "Assets-07.png",

    "0,6": "Assets-45.png",
    "1,6": "Assets-45.png",
    "2,6": "Assets-45.png",
    "3,6": "Assets-45.png",
    "4,6": "Assets-45.png",
    "6,6": "Assets-45.png",
    "8,6": "Assets-45.png",
    "9,6": "Assets-45.png",
    "10,6": "Assets-45.png",
    "11,6": "Assets-45.png",
    "12,6": "Assets-45.png",

    "5,6": { file: "Assets-45.png", overlay: "box_new.png" },
    "5,5": "Assets-48.png",
    "0,5": { file: "Assets-38.png", overlay: "box_new.png" },
    "0,4": "Assets-01.png",
    "1,5": { file: "Assets-46.png", opacity: SHADOW_OPACITY, fullPart: { top: 0.85 } },

    "12,3": "Assets-79.png",
    "6,5": "Assets-48.png",
    "6,4": "Assets-45.png",
    "12,5": "Assets-38.png",
    "12,4": "Assets-40.png",
    "11,5": { file: "Assets-77.png", opacity: SHADOW_OPACITY, fullPart: { top: 0.85 } },

    "1,4": { file: "Assets-03.png", opacity: SHADOW_OPACITY },
    "2,4": "Assets-07.png",
    "3,4": "Assets-07.png",
    "4,4": "Assets-07.png",
    "5,4": "Assets-07.png",
    "7,4": "Assets-07.png",
    "8,4": "Assets-07.png",
    "9,4": "Assets-07.png",
    "10,4": "Assets-07.png",
    "11,4": { file: "Assets-03.png", flipX: true, opacity: SHADOW_OPACITY },

    "2,5": "Assets-48.png",
    "3,5": "Assets-48.png",
    "4,5": "Assets-48.png",
    "8,5": "Assets-48.png",
    "9,5": "Assets-48.png",
    "7,5": "Assets-82.png",

    //"7,6": "Assets-81.png",
    "10,5": "Assets-48.png",

  },
};

// layoutName에서 "_4" 꼬리표를 떼어 base/_4가 같은 오버라이드 표를 쓰게 함
const overrideKey = (layoutName) => (layoutName || "").replace(/_4$/, "");

/* ──────────────────────────────────────────────────────────────────────────
 * 🔢 좌표 보기 
 *   true 로 바꾸면 맵의 모든 칸에 "x,y" 좌표가 표시됩니다.
 *   위 SKIN_OVERRIDE 에 넣을 좌표를 눈으로 확인할 때 켜고, 확인 후 다시 false 로.
 * ────────────────────────────────────────────────────────────────────────── */
const SHOW_GRID_COORDS = false;

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

  // 스킨 이미지 전체 프리로드 (마운트 시 1회)
  // SVG <image>는 처음 화면에 등장할 때에야 해당 PNG를 요청하므로,
  // 배포 환경에서는 로봇이 처음 방향을 바꾸거나 물건을 드는 순간
  // 오버레이 이미지가 아직 없어 흰색으로 보이는 현상이 생긴다.
  // 여기서 SKIN / SKIN_OVERRIDE에 등장하는 모든 파일을 미리 받아 브라우저 캐시에 올려둔다.
  useEffect(() => {
    const names = new Set();
    const collect = (v) => {
      if (typeof v === "string" && v.endsWith(".png")) names.add(v);
      else if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === "object") Object.values(v).forEach(collect);
    };
    collect(SKIN);
    collect(SKIN_OVERRIDE);
    names.forEach((name) => {
      const img = new Image();
      img.src = skinUrl(name);
    });
  }, []);

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

  // 설비 스킨 매핑 (맵 기호 → 이미지 경로). 파일명은 위 SKIN.station에서 관리
  const smartfactoryTileMap = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(SKIN.station).map(([cell, name]) => [cell, skinUrl(name)])
      ),
    []
  );

  const backgroundTiles = useMemo(
    () => {
      if (!spritesData) return null;
      // 타일 간 서브픽셀 틈 제거용 (값 조절로 겹침 정도 변경)
      const tb = 2;
      // 이 맵에 지정된 좌표별 스킨 오버라이드 표 (없으면 undefined)
      const overrideTable = SKIN_OVERRIDE[overrideKey(staticInfo.layoutName)];
      return grid.map((row, y) =>
        row.map((cell, x) => {
          let frameName = tileMap[cell];
          if (!frameName) {
            frameName = "floor.png";
          }
          const isDispenser = ["P", "S", "O", "D"].includes(cell);
          const smartfactoryImage = smartfactoryTileMap[cell];

          // 좌표 오버라이드가 지정된 칸이면 자동 스킨 대신 그 이미지로 교체
          const overrideKey_ = `${x},${y}`;
          const hasOverride = overrideTable && overrideKey_ in overrideTable;
          if (hasOverride) {
            const overrideEntry = overrideTable[overrideKey_];
            // null이면 해당 칸을 비움 (렌더링 안 함)
            if (overrideEntry === null) return <g key={`${x}-${y}`} />;
            // 문자열이면 기존 방식, 객체이면 { file, flipX, flipY, rotate } 지원
            const isObj = typeof overrideEntry === 'object';
            const overrideName = isObj ? overrideEntry.file : overrideEntry;
            const flipX = isObj && overrideEntry.flipX;
            const flipY = isObj && overrideEntry.flipY;
            const rotateDeg = (isObj && overrideEntry.rotate) || 0;
            const entryOpacity = isObj && overrideEntry.opacity !== undefined
              ? overrideEntry.opacity : FLOOR_TILE_OPACITY;
            const blendMode = (isObj && overrideEntry.blend) || null;
            const fullPart = isObj && overrideEntry.fullPart;

            // transform 구성: 중심점 기준 회전/반전
            const cx = x * gridSize - tb / 2 + (gridSize + tb) / 2;
            const cy = y * gridSize - tb / 2 + (gridSize + tb) / 2;
            const transforms = [];
            if (flipX || flipY || rotateDeg) {
              transforms.push(`translate(${cx}, ${cy})`);
              if (rotateDeg) transforms.push(`rotate(${rotateDeg})`);
              if (flipX) transforms.push('scale(-1, 1)');
              if (flipY) transforms.push('scale(1, -1)');
              transforms.push(`translate(${-cx}, ${-cy})`);
            }

            // opacity가 적용된 타일은 셀 경계로 클리핑 (블리드는 유지하되 겹침 방지)
            const cellClipId = entryOpacity < 1 ? `cell-${x}-${y}` : null;

            return (
              <g key={`${x}-${y}`}>
                {entryOpacity < 1 && (
                  <>
                    <defs>
                      <clipPath id={cellClipId}>
                        <rect x={x * gridSize} y={y * gridSize} width={gridSize} height={gridSize} />
                      </clipPath>
                    </defs>
                    <image
                      href={skinUrl("Assets-07.png")}
                      x={x * gridSize - tb / 2}
                      y={y * gridSize - tb / 2}
                      width={gridSize + tb}
                      height={gridSize + tb}
                      preserveAspectRatio="none"
                    />
                  </>
                )}
                <image
                  href={skinUrl(overrideName)}
                  x={x * gridSize - tb / 2}
                  y={y * gridSize - tb / 2}
                  width={gridSize + tb}
                  height={gridSize + tb}
                  preserveAspectRatio="none"
                  opacity={entryOpacity}
                  {...(cellClipId && { clipPath: `url(#${cellClipId})` })}
                  {...(blendMode && { style: { mixBlendMode: blendMode } })}
                  {...(transforms.length > 0 && { transform: transforms.join(' ') })}
                />
                {fullPart && (() => {
                  const tileX = x * gridSize - tb / 2;
                  const tileY = y * gridSize - tb / 2;
                  const tileW = gridSize + tb;
                  const tileH = gridSize + tb;
                  const clipTop = (fullPart.top || 0) * tileH;
                  const clipId = `fullpart-${x}-${y}`;
                  return (
                    <>
                      <defs>
                        <clipPath id={clipId}>
                          <rect
                            x={tileX}
                            y={tileY + clipTop}
                            width={tileW}
                            height={tileH - clipTop}
                          />
                        </clipPath>
                      </defs>
                      <image
                        href={skinUrl(overrideName)}
                        x={tileX}
                        y={tileY}
                        width={tileW}
                        height={tileH}
                        preserveAspectRatio="none"
                        clipPath={`url(#${clipId})`}
                        {...(transforms.length > 0 && { transform: transforms.join(' ') })}
                      />
                    </>
                  );
                })()}
                {/* 오버레이 이미지 (타일 위에 띄우기) */}
                {isObj && overrideEntry.overlay && (
                  <image
                    href={skinUrl(overrideEntry.overlay)}
                    x={x * gridSize + gridSize * 0.025}
                    y={y * gridSize - 14 + gridSize * 0.025}
                    width={gridSize * 0.95}
                    height={gridSize * 0.95}
                    preserveAspectRatio="xMidYMid meet"
                  />
                )}
              </g>
            );
          }

          // 맨 위 행 (y === 0): 벽 스킨으로 교체
          if (y === 0) {
            return (
              <g key={`${x}-${y}`}>
                <image
                  href={skinUrl(SKIN.wall)}
                  x={x * gridSize - tb / 2}
                  y={y * gridSize - tb / 2}
                  width={gridSize + tb}
                  height={gridSize + tb}
                  preserveAspectRatio="none"
                />
                {/* 디스펜서 타일이면 smartfactory 스킨 오버레이 */}
                {smartfactoryImage && (
                  <image
                    href={smartfactoryImage}
                    x={x * gridSize - tb / 2}
                    y={y * gridSize - tb / 2}
                    width={gridSize + tb}
                    height={gridSize + tb}
                    preserveAspectRatio="none"
                  />
                )}
              </g>
            );
          }

          // 맨 아래 행: 디스펜서/팟 제외한 나머지를 아래쪽 벽 스킨으로 교체
          if (y === grid.length - 1 && !smartfactoryImage) {
            return (
              <g key={`${x}-${y}`}>
                <image
                  href={skinUrl(SKIN.wallBottom)}
                  x={x * gridSize - tb / 2}
                  y={y * gridSize - tb / 2}
                  width={gridSize + tb}
                  height={gridSize + tb}
                  preserveAspectRatio="none"
                />
              </g>
            );
          }

          // 맨 아래 행의 디스펜서/팟: 아래쪽 벽 배경 + 설비 오버레이
          if (y === grid.length - 1 && smartfactoryImage) {
            return (
              <g key={`${x}-${y}`}>
                <image
                  href={skinUrl(SKIN.wallBottom)}
                  x={x * gridSize - tb / 2}
                  y={y * gridSize - tb / 2}
                  width={gridSize + tb}
                  height={gridSize + tb}
                  preserveAspectRatio="none"
                />
                <image
                  href={smartfactoryImage}
                  x={x * gridSize - tb / 2}
                  y={y * gridSize - tb / 2}
                  width={gridSize + tb}
                  height={gridSize + tb}
                  preserveAspectRatio="none"
                />
              </g>
            );
          }

          // 왼쪽/오른쪽 벽 (가장자리 카운터): 벽 스킨으로 교체
          if ((x === 0 || x === row.length - 1) && cell !== " ") {
            return (
              <g key={`${x}-${y}`}>
                <image
                  href={skinUrl(SKIN.wall)}
                  x={x * gridSize - tb / 2}
                  y={y * gridSize - tb / 2}
                  width={gridSize + tb}
                  height={gridSize + tb}
                  preserveAspectRatio="none"
                />
                {smartfactoryImage && (
                  <image
                    href={smartfactoryImage}
                    x={x * gridSize - tb / 2}
                    y={y * gridSize - tb / 2}
                    width={gridSize + tb}
                    height={gridSize + tb}
                    preserveAspectRatio="none"
                  />
                )}
              </g>
            );
          }

          // smartfactory 스킨이 있는 타일 (양파, 접시, pot)
          if (smartfactoryImage) {
            return (
              <g key={`${x}-${y}`}>
                {/* 카운터 바닥 먼저 깔기 (서빙대는 이미지가 전체를 덮으므로 제외) */}
                {cell !== 'S' && renderSprite('terrain', 'counter.png', x * gridSize, y * gridSize, gridSize)}
                <image
                  href={smartfactoryImage}
                  x={x * gridSize - tb / 2}
                  y={y * gridSize - tb / 2}
                  width={gridSize + tb}
                  height={gridSize + tb}
                  preserveAspectRatio="none"
                />
              </g>
            );
          }

          // 바닥 타일 (걸어다니는 공간): smartfactory 스킨 적용
          // 코너는 Assets-06, 단독 가장자리는 Assets-02/03 사용
          if (cell === " ") {
            const W = row.length;
            const H = grid.length;

            // 그림자를 만드는 것은 "외곽(테두리) 벽"뿐.
            // 중앙 분리대 같은 내부 벽은 그림자를 만들지 않아 주위 바닥이 순수 바닥(Assets-07)으로 남는다.
            const isShadowWall = (cx, cy) => {
              // 격자 밖 = 맵 바깥 외곽 → 그림자 만듦
              if (cx < 0 || cy < 0 || cx >= W || cy >= H) return true;
              const c = grid[cy][cx];
              if (c === " ") return false; // 바닥이면 벽 아님
              // 벽/설비 칸: 테두리에 있을 때만 그림자를 만든다 (내부 벽은 제외)
              return cx === 0 || cx === W - 1 || cy === 0 || cy === H - 1;
            };

            const hasWallLeft = isShadowWall(x - 1, y);
            const hasWallRight = isShadowWall(x + 1, y);
            const hasWallAbove = isShadowWall(x, y - 1);
            const hasWallBelow = isShadowWall(x, y + 1);

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

            const edgeOpacity = SKIN.floorEdgeOpacity;
            const edgeOverlays = [];

            // 코너 오버레이 (회전/반전으로 4방향 재사용)
            if (hasCornerTL) {
              edgeOverlays.push(
                <image key="ctl" href={skinUrl(SKIN.floorCorner)}
                  x={x * gridSize} y={y * gridSize}
                  width={gridSize} height={gridSize}
                  preserveAspectRatio="none"
                  opacity={edgeOpacity}
                />
              );
            }
            if (hasCornerTR) {
              edgeOverlays.push(
                <image key="ctr" href={skinUrl(SKIN.floorCorner)}
                  x={x * gridSize} y={y * gridSize}
                  width={gridSize} height={gridSize}
                  preserveAspectRatio="none"
                  opacity={edgeOpacity}
                  transform={`translate(${x * gridSize * 2 + gridSize}, 0) scale(-1, 1)`}
                />
              );
            }
            if (hasCornerBL) {
              edgeOverlays.push(
                <image key="cbl" href={skinUrl(SKIN.floorCorner)}
                  x={x * gridSize} y={y * gridSize}
                  width={gridSize} height={gridSize}
                  preserveAspectRatio="none"
                  opacity={edgeOpacity}
                  transform={`translate(0, ${y * gridSize * 2 + gridSize}) scale(1, -1)`}
                />
              );
            }
            if (hasCornerBR) {
              edgeOverlays.push(
                <image key="cbr" href={skinUrl(SKIN.floorCorner)}
                  x={x * gridSize} y={y * gridSize}
                  width={gridSize} height={gridSize}
                  preserveAspectRatio="none"
                  opacity={edgeOpacity}
                  transform={`translate(${x * gridSize * 2 + gridSize}, ${y * gridSize * 2 + gridSize}) scale(-1, -1)`}
                />
              );
            }

            // 단독 가장자리 오버레이 (코너에 포함되지 않은 면만)
            if (edgeTop) {
              edgeOverlays.push(
                <image key="top" href={skinUrl(SKIN.floorEdgeTop)}
                  x={x * gridSize} y={y * gridSize}
                  width={gridSize} height={gridSize}
                  preserveAspectRatio="none"
                  opacity={edgeOpacity}
                />
              );
            }
            if (edgeBottom) {
              edgeOverlays.push(
                <image key="bottom" href={skinUrl(SKIN.floorEdgeBottom)}
                  x={x * gridSize} y={y * gridSize}
                  width={gridSize} height={gridSize}
                  preserveAspectRatio="none"
                  opacity={edgeOpacity}
                  transform={`translate(0, ${y * gridSize * 2 + gridSize}) scale(1, -1)`}
                />
              );
            }
            if (edgeLeft) {
              edgeOverlays.push(
                <image key="left" href={skinUrl(SKIN.floorEdgeSide)}
                  x={x * gridSize} y={y * gridSize}
                  width={gridSize} height={gridSize}
                  preserveAspectRatio="none"
                  opacity={edgeOpacity}
                />
              );
            }
            if (edgeRight) {
              edgeOverlays.push(
                <image key="right" href={skinUrl(SKIN.floorEdgeSide)}
                  x={x * gridSize} y={y * gridSize}
                  width={gridSize} height={gridSize}
                  preserveAspectRatio="none"
                  opacity={edgeOpacity}
                  transform={`translate(${x * gridSize * 2 + gridSize}, 0) scale(-1, 1)`}
                />
              );
            }

            return (
              <g key={`${x}-${y}`}>
                <image
                  href={skinUrl(SKIN.floor)}
                  x={x * gridSize - tb / 2}
                  y={y * gridSize - tb / 2}
                  width={gridSize + tb}
                  height={gridSize + tb}
                  preserveAspectRatio="none"
                />
                {edgeOverlays}
              </g>
            );
          }

          return (
            <g key={`${x}-${y}`}>
              {/* 중간 카운터 타일 → 벽 스킨 */}
              {cell === "X" ? (
                <image
                  href={skinUrl(SKIN.wall)}
                  x={x * gridSize - tb / 2}
                  y={y * gridSize - tb / 2}
                  width={gridSize + tb}
                  height={gridSize + tb}
                  preserveAspectRatio="none"
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
    [grid, spritesData, tileMap, smartfactoryTileMap, staticInfo.layoutName]
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

    // pot 위의 soup인 경우 1mat / 2mat / 3mat / ready(Assets-88) 이미지 적용
    if (obj.name === "soup" && cell === "P") {
      const count = obj.numIngredients ?? obj.ingredients?.length ?? 0;
      const isReady = obj.isReady;
      let smartfactorySoupImage;
      if (isReady) {
        smartfactorySoupImage = skinUrl(SKIN.pot.ready);
      } else if (count >= 3) {
        smartfactorySoupImage = skinUrl(SKIN.pot.mat3);
      } else if (count === 2) {
        smartfactorySoupImage = skinUrl(SKIN.pot.mat2);
      } else if (count === 1) {
        smartfactorySoupImage = skinUrl(SKIN.pot.mat1);
      }

      return (
        <g key={objectKey}>
          {smartfactorySoupImage && (
            <image
              href={smartfactorySoupImage}
              x={x * gridSize}
              y={y * gridSize}
              width={gridSize}
              height={gridSize}
              preserveAspectRatio="xMidYMid slice"
              opacity={1}
              style={!isReady ? { filter: POT_INGREDIENT_FILTER } : undefined}
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          )}

          {/* 조리 완료 → 타이머와 동일한 원형 스타일 체크 배지 */}
          {isReady && (() => {
            const ccx = x * gridSize + gridSize / 2 + 2;
            const ccy = y * gridSize + gridSize / 2;
            return (
              <g>
                <circle cx={ccx} cy={ccy} r={19} fill="rgba(0,0,0,0.5)" />
                <circle
                  cx={ccx} cy={ccy} r={16}
                  fill="none" stroke="#34c759" strokeWidth={4}
                />
                <path
                  d={`M ${ccx - 7} ${ccy} l 5 6 l 10 -12`}
                  fill="none" stroke="#fff" strokeWidth={3}
                  strokeLinecap="round" strokeLinejoin="round"
                />
              </g>
            );
          })()}

          {cooking && remainingTime !== null && (() => {
            const r = 16;
            const sw = 4;
            const cx = x * gridSize + gridSize / 2 + 2;
            const cy = y * gridSize + gridSize / 2;
            const circumference = 2 * Math.PI * r;
            const progress = 1 - remainingTime / cookTotalForBar;
            const dashOffset = circumference * (1 - progress);

            return (
              <g>
                <circle cx={cx} cy={cy} r={r + 3} fill="rgba(0,0,0,0.5)" />
                <circle
                  cx={cx} cy={cy} r={r}
                  fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={sw}
                />
                <circle
                  cx={cx} cy={cy} r={r}
                  fill="none"
                  stroke={progress < 0.5 ? "#ff9500" : progress < 0.85 ? "#ffcc00" : "#34c759"}
                  strokeWidth={sw} strokeLinecap="round"
                  strokeDasharray={circumference} strokeDashoffset={dashOffset}
                  transform={`rotate(-90 ${cx} ${cy})`}
                />
                <text
                  x={cx} y={cy + 5}
                  textAnchor="middle" fontSize="14" fontWeight="bold"
                  fontFamily="monospace" fill="#fff"
                  stroke="#000" strokeWidth="2" paintOrder="stroke"
                  style={{ strokeLinejoin: "round" }}
                >
                  {Math.ceil(remainingTime)}
                </text>
              </g>
            );
          })()}
        </g>
      );
    }

    // 카운터 위 양파/토마토 → smartfactory Assets-13
    // 카운터 위 접시(상자) → smartfactory Assets-11
    if ((obj.name === "onion" || obj.name === "tomato") && cell !== "P") {
      return (
        <g key={objectKey}>
          <image
            href={skinUrl(SKIN.itemOnCounter.ingredient)}
            x={x * gridSize}
            y={y * gridSize}
            width={gridSize}
            height={gridSize}
            preserveAspectRatio="xMidYMid slice"
            style={{ filter: INGREDIENT_FILTER }}
          />
        </g>
      );
    }

    if (obj.name === "dish" && cell !== "P") {
      return (
        <g key={objectKey}>
          <image
            href={skinUrl(SKIN.itemOnCounter.dish)}
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

    const scale = 1.25;
    const offset = (gridSize * (scale - 1)) / 2;

    const orientationPlayer = movementProgress > 0.15 ? targetPlayer : player;
    const rawOrientation = orientationPlayer.orientation || player.orientation || "south";
    const orientation = normalizeDir(rawOrientation);

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

    // smartfactory 셰프 이미지 매핑 (파일명은 위 SKIN.chef에서 관리)
    const colorIndex = index % SKIN.chef.sideColor.length;
    const frontColor = skinUrl(SKIN.chef.frontColor[colorIndex]);
    const sideColor = skinUrl(SKIN.chef.sideColor[colorIndex]);
    const chefFront = skinUrl(SKIN.chef.front);
    const chefSide = skinUrl(SKIN.chef.side);

    let chefImage = chefFront; // 기본: 아래
    let chefFlip = "";
    let colorOverlay = frontColor;
    let colorFlip = "";

    if (orientation === "WEST") {
      chefImage = chefSide;
      colorOverlay = sideColor;
    } else if (orientation === "EAST") {
      chefImage = chefSide;
      chefFlip = `translate(${gridSize}, 0) scale(-1, 1)`;
      colorOverlay = sideColor;
      colorFlip = `translate(${gridSize}, 0) scale(-1, 1)`;
    } else if (orientation === "NORTH") {
      chefImage = chefFront;
      colorOverlay = frontColor;
    } else if (orientation === "SOUTH") {
      chefImage = chefFront;
      chefFlip = `translate(0, ${gridSize}) scale(1, -1)`;
      colorOverlay = frontColor;
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
          preserveAspectRatio="none"
          transform={chefFlip || undefined}
          style={{ imageRendering: "auto" }}
        />
        {/* 들고 있는 물건 - smartfactory 이미지 (색상 오버레이 아래에 렌더) */}
        {(() => {
          // 재료 (onion, tomato): side=28, front/back=27
          // 빈 박스 (dish): side=20, front/back=14
          // 완성품 (soup): side=25, front/back=26
          const isSideView = orientation === "WEST" || orientation === "EAST";
          let heldAsset = null;

          if (heldLower === "onion" || heldLower === "tomato") {
            heldAsset = skinUrl(isSideView ? SKIN.held.ingredientSide : SKIN.held.ingredientFront);
          } else if (heldLower === "dish") {
            heldAsset = skinUrl(isSideView ? SKIN.held.dishSide : SKIN.held.dishFront);
          } else if (heldLower.includes("soup")) {
            heldAsset = skinUrl(isSideView ? SKIN.held.soupSide : SKIN.held.soupFront);
          }

          const isIngredient = heldLower === "onion" || heldLower === "tomato";
          if (!heldAsset) return null;
          return (
            <image
              href={heldAsset}
              x={0}
              y={0}
              width={gridSize}
              height={gridSize}
              preserveAspectRatio="none"
              transform={chefFlip || undefined}
              style={{
                imageRendering: "auto",
                ...(isIngredient ? { filter: HELD_INGREDIENT_FILTER } : {})
              }}
            />
          );
        })()}
        {/* 에이전트별 색상 오버레이 (항상 맨 위에 렌더) */}
        {(() => {
          // front 이미지(agv2: 64×63)와 color overlay(Assets-93: 64×64)의
          // 내부 컨텐츠 위치 차이를 보정하는 오프셋
          const isFrontView = orientation === "NORTH" || orientation === "SOUTH";
          const colorOffsetX = isFrontView ? -2 : 0;
          return (
            <image
              href={colorOverlay}
              x={colorOffsetX}
              y={0}
              width={gridSize}
              height={gridSize}
              preserveAspectRatio="none"
              transform={colorFlip || undefined}
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
        viewBox={`${-gridSize * 0.3} ${-gridSize * 0.3} ${boardWidth + gridSize * 0.6} ${boardHeight + gridSize * 0.6}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          flex: "0 0 auto",
          maxWidth: "100%",
          maxHeight: "100%",
          border: "none",
          background: "#787878",
          borderRadius: "8px",
          imageRendering: "pixelated",
          overflow: "visible"
        }}
      >
        {/* 정적 배경: 타일 필터 적용 */}
        <g style={{ filter: TILE_FILTER }}>
          {backgroundTiles}
        </g>
        {/* 동적 오브젝트 */}
        <g style={{ filter: OBJECT_FILTER }}>
          {combinedObjects.map((obj, index) => renderObject(obj, getObjectKey(obj, index)))}
        </g>
        {(playerFrame.players || []).map((p, i) => renderPlayer(p, i))}

        {/* 좌표 보기 오버레이 (SHOW_GRID_COORDS = true 일 때만) */}
        {SHOW_GRID_COORDS &&
          grid.map((row, y) =>
            row.map((_, x) => (
              <text
                key={`coord-${x}-${y}`}
                x={x * gridSize + gridSize / 2}
                y={y * gridSize + gridSize / 2 + 5}
                textAnchor="middle"
                fontSize="16"
                fontWeight="bold"
                fontFamily="monospace"
                fill="#ffff00"
                stroke="#000000"
                strokeWidth="3"
                paintOrder="stroke"
                style={{ strokeLinejoin: "round", pointerEvents: "none" }}
              >
                {x},{y}
              </text>
            ))
          )}

        {/* 배달 팝업 이펙트 */}
        {deliveryEffects.map((eff, index) => {
          const mapW = staticInfo.width || (grid && grid[0] ? grid[0].length : 5);
          const mapH = staticInfo.height || (grid ? grid.length : 5);

          let sTile = serveTiles.length > 0 ? serveTiles[index % serveTiles.length] : null;
          if (!sTile) {
            sTile = { x: mapW / 2 - 0.5, y: mapH / 2 - 0.5 };
          }

          const cx = sTile.x * gridSize + gridSize / 2;
          const cy = sTile.y * gridSize + gridSize / 2;

          return (
            <g key={eff.id} style={{ pointerEvents: "none" }}>
              <g style={{
                animation: "deliveryFloat 1.4s ease-out forwards",
                transformOrigin: `${cx}px ${cy}px`,
              }}>
                {/* 배경 pill */}
                <rect
                  x={cx - 38} y={cy - 16}
                  width={76} height={28} rx={14}
                  fill="rgba(0,0,0,0.6)"
                />
                {/* DONE 텍스트 */}
                <text
                  x={cx - 5} y={cy + 4}
                  textAnchor="middle"
                  fontSize="16" fontWeight="bold"
                  fontFamily="monospace" fill="#34c759"
                >
                  DROP
                </text>
                {/* ✓ 체크 */}
                <path
                  d={`M ${cx + 20} ${cy - 2} l 4 5 l 8 -9`}
                  fill="none" stroke="#34c759" strokeWidth={2.5}
                  strokeLinecap="round" strokeLinejoin="round"
                />
              </g>
            </g>
          );
        })}

        {/* 팝업 이펙트용 스타일 정의 */}
        <style>{`
          @keyframes deliveryFloat {
            0% { transform: translateY(0px); opacity: 0; }
            10% { transform: translateY(-8px); opacity: 1; }
            65% { transform: translateY(-25px); opacity: 1; }
            100% { transform: translateY(-35px); opacity: 0; }
          }
        `}</style>
      </svg>
    </div>
  );
}
