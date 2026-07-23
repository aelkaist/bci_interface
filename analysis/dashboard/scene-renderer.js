const CHEF_HAT_VARIANTS = ["bluehat", "greenhat", "orangehat", "purplehat", "redhat"];
const gridSize = 80;

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
  return moved;
}

const SKIN_DIR = "./smartfactory";
const FLOOR_TILE_OPACITY = 1.0;
const SHADOW_OPACITY = 0.45;
const TILE_FILTER = "brightness(0.75) contrast(1.35) saturate(0.9)";
const OBJECT_FILTER = "brightness(0.80) contrast(1.2)";
const INGREDIENT_FILTER = "brightness(0.95) contrast(1.05)";
const POT_INGREDIENT_FILTER = "brightness(0.75) contrast(1.15)";
const HELD_INGREDIENT_FILTER = "brightness(0.83) contrast(1.10)";

const SKIN = {
  wall: "Assets-01.png",
  wallBottom: "Assets-05.png",
  floor: "Assets-07.png",
  floorEdgeTop: "Assets-02.png",
  floorEdgeBottom: "Assets-07.png",
  floorEdgeSide: "Assets-03.png",
  floorCorner: "Assets-06.png",
  floorEdgeOpacity: 0.4,

  station: {
    O: "Assets-55.png",
    D: "Assets-11.png",
    P: "Assets-103.png",
    S: "drop6.png",
  },
  pot: {
    mat1: "1mat.png",
    mat2: "2mat.png",
    mat3: "3mat.png",
    ready: "Assets-88.png",
  },
  itemOnCounter: {
    ingredient: "material.png",
    dish: "box_new.png",
  },
  chef: {
    front: "agv2.png",
    side: "agv.png",
    frontColor: ["Assets-93.png", "Assets-94.png", "Assets-95.png", "Assets-96.png"],
    sideColor: ["Assets-89.png", "Assets-90.png", "Assets-91.png", "Assets-92.png"],
  },
  held: {
    ingredientFront: "materialfront.png",
    ingredientSide: "materialside.png",
    dishFront: "openboxfront.png",
    dishSide: "openboxside.png",
    soupFront: "boxfront.png",
    soupSide: "boxside.png",
  },
};

const skinUrl = (name) => `${SKIN_DIR}/${name}`;

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
    "10,5": "Assets-48.png",
  }
};

const overrideKey = (layoutName) => (layoutName || "").replace(/_4$/, "");

const smartfactoryTileMap = Object.fromEntries(
  Object.entries(SKIN.station).map(([cell, name]) => [cell, skinUrl(name)])
);

const tileMap = {
  "X": "counter.png", " ": "floor.png", "P": "pot.png",
  "S": "serve.png", "O": "onions.png", "D": "dishes.png", "T": "tomatoes.png"
};

const SOURCE_SIZES = {
  chefs: { w: 119, h: 119 },
  objects: { w: 255, h: 17 },
  terrain: { w: 119, h: 17 },
  soups: { w: 405, h: 15 },
};

export class SceneRenderer {
  constructor(container) {
    this.container = container;
    this.spritesData = null;
    
    // Create main SVG
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.style.border = "none";
    this.svg.style.background = "#787878";
    this.svg.style.borderRadius = "8px";
    this.svg.style.imageRendering = "pixelated";
    this.svg.style.width = "100%";
    this.svg.style.height = "100%";
    this.svg.style.maxWidth = "100%";
    this.svg.style.maxHeight = "100%";
    this.svg.style.display = "block";
    this.svg.style.overflow = "visible";
    
    // Defs for animations
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = `
      @keyframes popSlideUp {
        0% { transform: translateY(0px); opacity: 0; }
        20% { transform: translateY(-15px); opacity: 1; }
        80% { transform: translateY(-25px); opacity: 1; }
        100% { transform: translateY(-30px); opacity: 0; }
      }
    `;
    defs.appendChild(style);
    this.svg.appendChild(defs);
    
    // Groups for layering
    this.bgGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.bgGroup.setAttribute('style', `filter: ${TILE_FILTER}`);
    this.svg.appendChild(this.bgGroup);

    this.objGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.objGroup.setAttribute('style', `filter: ${OBJECT_FILTER}`);
    this.svg.appendChild(this.objGroup);

    this.playerGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.svg.appendChild(this.playerGroup);

    this.container.innerHTML = '';
    this.container.appendChild(this.svg);
  }

  async loadSprites() {
    if (this.spritesData) return;
    try {
      const [chefs, objects, terrain, soups] = await Promise.all([
        fetch('./graphics/chefs.json').then(r=>r.json()),
        fetch('./graphics/objects.json').then(r=>r.json()),
        fetch('./graphics/terrain.json').then(r=>r.json()),
        fetch('./graphics/soups.json').then(r=>r.json())
      ]);
      
      const parsed = { chefs: {}, objects: {}, terrain: {}, soups: {} };
      const processFrames = (json, category) => {
        if (!json) return;
        if (json.frames && !Array.isArray(json.frames)) {
          Object.keys(json.frames).forEach(k => {
            parsed[category][k] = json.frames[k];
          });
        }
      };
      processFrames(chefs, 'chefs');
      processFrames(objects, 'objects');
      processFrames(terrain, 'terrain');
      if (soups.textures && soups.textures[0] && soups.textures[0].frames) {
        soups.textures[0].frames.forEach(f => {
          parsed.soups[f.filename] = f;
        });
      }
      this.spritesData = parsed;
    } catch (e) {
      console.warn("Legacy sprite load fallback:", e);
      this.spritesData = { chefs: {}, objects: {}, terrain: {}, soups: {} };
    }
  }

  renderSprite(category, frameName, x, y, size, opacity = 1) {
    if (!this.spritesData || !this.spritesData[category]) return null;
    let data = this.spritesData[category][frameName];

    if (!data) {
      if (category === "chefs") {
        const hatMatch = frameName.match(/-(bluehat|greenhat|orangehat|purplehat|redhat)\.png$/);
        const fallbackHat = hatMatch ? `SOUTH-${hatMatch[1]}.png` : "SOUTH-bluehat.png";
        data = this.spritesData[category][fallbackHat] || this.spritesData[category]["SOUTH.png"];
        if (!data) return null;
      } else {
        return null;
      }
    }

    const f = data.frame;
    const scale = size / 15; 
    const drawW = f.w * scale;
    const drawH = f.h * scale;
    const source = SOURCE_SIZES[category];

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    g.setAttribute('x', x);
    g.setAttribute('y', y);
    g.setAttribute('width', drawW);
    g.setAttribute('height', drawH);
    g.setAttribute('viewBox', `0 0 ${f.w} ${f.h}`);
    g.setAttribute('opacity', opacity);
    g.style.overflow = "hidden";
    
    const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    img.setAttribute('href', `./graphics/${category}.png`);
    img.setAttribute('x', -f.x);
    img.setAttribute('y', -f.y);
    img.setAttribute('width', source.w);
    img.setAttribute('height', source.h);
    img.setAttribute('preserveAspectRatio', 'none');
    
    g.appendChild(img);
    return g;
  }

  normalizeDir(dir) {
    if (!dir) return "SOUTH";
    const s = String(dir).toUpperCase().trim();
    if (["NORTH", "SOUTH", "EAST", "WEST"].includes(s)) return s;
    if (s === "UP" || s.includes("-1")) return "NORTH";     
    if (s === "DOWN" || s.includes("1")) return "SOUTH";    
    if (s === "RIGHT" || s.includes("1")) return "EAST";    
    if (s === "LEFT" || s.includes("-1")) return "WEST";    
    return "SOUTH";
  }

  isHeldByPlayer(frame, obj) {
    return (frame.players || []).some((p) => {
      const h = p.heldObject;
      if (!h) return false;
      return (h.name === obj.name && h.position?.x === obj.position.x && h.position?.y === obj.position.y);
    });
  }

  getObjectKey(obj, fallbackIndex = 0) {
    const pos = obj?.position;
    if (!pos) return `obj-${obj?.name || "unknown"}-${fallbackIndex}`;
    return `obj-${obj?.name || "unknown"}-${pos.x}-${pos.y}`;
  }

  createImageNode(href, x, y, width, height, preserveRatio = "none", opacity = 1, transform = null, filter = null) {
    const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    img.setAttribute('href', href);
    img.setAttribute('x', x);
    img.setAttribute('y', y);
    img.setAttribute('width', width);
    img.setAttribute('height', height);
    img.setAttribute('preserveAspectRatio', preserveRatio);
    if (opacity !== 1) img.setAttribute('opacity', opacity);
    if (transform) img.setAttribute('transform', transform);
    if (filter) img.style.filter = filter;
    img.onerror = () => { img.setAttribute('display', 'none'); };
    return img;
  }

  renderBackgroundTiles(staticInfo) {
    const { grid, width, height, layoutName } = staticInfo;
    const tb = 2;
    const overrideTable = SKIN_OVERRIDE[overrideKey(layoutName)];
    const frag = document.createDocumentFragment();

    grid.forEach((row, y) => {
      [...row].forEach((cell, x) => {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        let frameName = tileMap[cell] || "floor.png";
        const isDispenser = ["P", "S", "O", "D"].includes(cell);
        const smartfactoryImage = smartfactoryTileMap[cell];

        const overrideKey_ = `${x},${y}`;
        const hasOverride = overrideTable && overrideKey_ in overrideTable;

        if (hasOverride) {
          const overrideEntry = overrideTable[overrideKey_];
          if (overrideEntry === null) {
            frag.appendChild(g);
            return;
          }

          const isObj = typeof overrideEntry === 'object';
          const overrideName = isObj ? overrideEntry.file : overrideEntry;
          const flipX = isObj && overrideEntry.flipX;
          const flipY = isObj && overrideEntry.flipY;
          const rotateDeg = (isObj && overrideEntry.rotate) || 0;
          const entryOpacity = isObj && overrideEntry.opacity !== undefined ? overrideEntry.opacity : FLOOR_TILE_OPACITY;
          const blendMode = (isObj && overrideEntry.blend) || null;
          const fullPart = isObj && overrideEntry.fullPart;

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

          const cellClipId = entryOpacity < 1 ? `cell-${x}-${y}` : null;
          if (entryOpacity < 1) {
            const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            const clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
            clipPath.setAttribute('id', cellClipId);
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', x * gridSize);
            rect.setAttribute('y', y * gridSize);
            rect.setAttribute('width', gridSize);
            rect.setAttribute('height', gridSize);
            clipPath.appendChild(rect);
            defs.appendChild(clipPath);
            g.appendChild(defs);

            g.appendChild(this.createImageNode(skinUrl("Assets-07.png"), x * gridSize - tb / 2, y * gridSize - tb / 2, gridSize + tb, gridSize + tb));
          }

          const mainImg = this.createImageNode(skinUrl(overrideName), x * gridSize - tb / 2, y * gridSize - tb / 2, gridSize + tb, gridSize + tb, "none", entryOpacity, transforms.length > 0 ? transforms.join(' ') : null);
          if (cellClipId) mainImg.setAttribute('clip-path', `url(#${cellClipId})`);
          if (blendMode) mainImg.style.mixBlendMode = blendMode;
          g.appendChild(mainImg);

          if (fullPart) {
            const tileX = x * gridSize - tb / 2;
            const tileY = y * gridSize - tb / 2;
            const tileW = gridSize + tb;
            const tileH = gridSize + tb;
            const clipTop = (fullPart.top || 0) * tileH;
            const clipId = `fullpart-${x}-${y}`;

            const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            const clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
            clipPath.setAttribute('id', clipId);
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', tileX);
            rect.setAttribute('y', tileY + clipTop);
            rect.setAttribute('width', tileW);
            rect.setAttribute('height', tileH - clipTop);
            clipPath.appendChild(rect);
            defs.appendChild(clipPath);
            g.appendChild(defs);

            const fpImg = this.createImageNode(skinUrl(overrideName), tileX, tileY, tileW, tileH, "none", 1, transforms.length > 0 ? transforms.join(' ') : null);
            fpImg.setAttribute('clip-path', `url(#${clipId})`);
            g.appendChild(fpImg);
          }

          if (isObj && overrideEntry.overlay) {
            g.appendChild(this.createImageNode(skinUrl(overrideEntry.overlay), x * gridSize + gridSize * 0.025, y * gridSize - 14 + gridSize * 0.025, gridSize * 0.95, gridSize * 0.95, "xMidYMid meet"));
          }

          frag.appendChild(g);
          return;
        }

        if (y === 0) {
          g.appendChild(this.createImageNode(skinUrl(SKIN.wall), x * gridSize - tb / 2, y * gridSize - tb / 2, gridSize + tb, gridSize + tb));
          if (smartfactoryImage) {
            g.appendChild(this.createImageNode(smartfactoryImage, x * gridSize - tb / 2, y * gridSize - tb / 2, gridSize + tb, gridSize + tb));
          }
          frag.appendChild(g);
          return;
        }

        if (y === grid.length - 1) {
          g.appendChild(this.createImageNode(skinUrl(SKIN.wallBottom), x * gridSize - tb / 2, y * gridSize - tb / 2, gridSize + tb, gridSize + tb));
          if (smartfactoryImage) {
            g.appendChild(this.createImageNode(smartfactoryImage, x * gridSize - tb / 2, y * gridSize - tb / 2, gridSize + tb, gridSize + tb));
          }
          frag.appendChild(g);
          return;
        }

        if ((x === 0 || x === row.length - 1) && cell !== " ") {
          g.appendChild(this.createImageNode(skinUrl(SKIN.wall), x * gridSize - tb / 2, y * gridSize - tb / 2, gridSize + tb, gridSize + tb));
          if (smartfactoryImage) {
            g.appendChild(this.createImageNode(smartfactoryImage, x * gridSize - tb / 2, y * gridSize - tb / 2, gridSize + tb, gridSize + tb));
          }
          frag.appendChild(g);
          return;
        }

        if (smartfactoryImage) {
          if (cell !== 'S') {
            const sp = this.renderSprite('terrain', 'counter.png', x * gridSize, y * gridSize, gridSize);
            if (sp) g.appendChild(sp);
          }
          g.appendChild(this.createImageNode(smartfactoryImage, x * gridSize - tb / 2, y * gridSize - tb / 2, gridSize + tb, gridSize + tb));
          frag.appendChild(g);
          return;
        }

        if (cell === " ") {
          const W = row.length;
          const H = grid.length;
          const isShadowWall = (cx, cy) => {
            if (cx < 0 || cy < 0 || cx >= W || cy >= H) return true;
            const c = grid[cy][cx];
            if (c === " ") return false;
            return cx === 0 || cx === W - 1 || cy === 0 || cy === H - 1;
          };

          const hasWallLeft = isShadowWall(x - 1, y);
          const hasWallRight = isShadowWall(x + 1, y);
          const hasWallAbove = isShadowWall(x, y - 1);
          const hasWallBelow = isShadowWall(x, y + 1);

          const hasCornerTL = hasWallAbove && hasWallLeft;
          const hasCornerTR = hasWallAbove && hasWallRight;
          const hasCornerBL = hasWallBelow && hasWallLeft;
          const hasCornerBR = hasWallBelow && hasWallRight;

          const edgeTop = hasWallAbove && !hasCornerTL && !hasCornerTR;
          const edgeBottom = hasWallBelow && !hasCornerBL && !hasCornerBR;
          const edgeLeft = hasWallLeft && !hasCornerTL && !hasCornerBL;
          const edgeRight = hasWallRight && !hasCornerTR && !hasCornerBR;

          const edgeOpacity = SKIN.floorEdgeOpacity;
          g.appendChild(this.createImageNode(skinUrl(SKIN.floor), x * gridSize - tb / 2, y * gridSize - tb / 2, gridSize + tb, gridSize + tb));

          if (hasCornerTL) g.appendChild(this.createImageNode(skinUrl(SKIN.floorCorner), x * gridSize, y * gridSize, gridSize, gridSize, "none", edgeOpacity));
          if (hasCornerTR) g.appendChild(this.createImageNode(skinUrl(SKIN.floorCorner), x * gridSize, y * gridSize, gridSize, gridSize, "none", edgeOpacity, `translate(${x * gridSize * 2 + gridSize}, 0) scale(-1, 1)`));
          if (hasCornerBL) g.appendChild(this.createImageNode(skinUrl(SKIN.floorCorner), x * gridSize, y * gridSize, gridSize, gridSize, "none", edgeOpacity, `translate(0, ${y * gridSize * 2 + gridSize}) scale(1, -1)`));
          if (hasCornerBR) g.appendChild(this.createImageNode(skinUrl(SKIN.floorCorner), x * gridSize, y * gridSize, gridSize, gridSize, "none", edgeOpacity, `translate(${x * gridSize * 2 + gridSize}, ${y * gridSize * 2 + gridSize}) scale(-1, -1)`));

          if (edgeTop) g.appendChild(this.createImageNode(skinUrl(SKIN.floorEdgeTop), x * gridSize, y * gridSize, gridSize, gridSize, "none", edgeOpacity));
          if (edgeBottom) g.appendChild(this.createImageNode(skinUrl(SKIN.floorEdgeBottom), x * gridSize, y * gridSize, gridSize, gridSize, "none", edgeOpacity, `translate(0, ${y * gridSize * 2 + gridSize}) scale(1, -1)`));
          if (edgeLeft) g.appendChild(this.createImageNode(skinUrl(SKIN.floorEdgeSide), x * gridSize, y * gridSize, gridSize, gridSize, "none", edgeOpacity));
          if (edgeRight) g.appendChild(this.createImageNode(skinUrl(SKIN.floorEdgeSide), x * gridSize, y * gridSize, gridSize, gridSize, "none", edgeOpacity, `translate(${x * gridSize * 2 + gridSize}, 0) scale(-1, 1)`));

          frag.appendChild(g);
          return;
        }

        if (cell === "X") {
          g.appendChild(this.createImageNode(skinUrl(SKIN.wall), x * gridSize - tb / 2, y * gridSize - tb / 2, gridSize + tb, gridSize + tb));
        } else {
          if (isDispenser) {
            const sp = this.renderSprite('terrain', 'counter.png', x * gridSize, y * gridSize, gridSize);
            if (sp) g.appendChild(sp);
          }
          const sp = this.renderSprite('terrain', frameName, x * gridSize, y * gridSize, gridSize);
          if (sp) g.appendChild(sp);
        }

        frag.appendChild(g);
      });
    });

    return frag;
  }

  renderObject(staticInfo, frame, obj, remainingByKey, cookTotalForBar) {
    if (this.isHeldByPlayer(frame, obj)) return null;
    const { x, y } = obj.position;
    const cell = staticInfo.grid[y]?.[x];
    if (cell === "S") return null;

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    let remainingTime = null;
    let cooking = false;

    if (obj.name === "soup" && cell === "P") {
      const count = obj.numIngredients ?? obj.ingredients?.length ?? 0;
      const isReady = obj.isReady;
      let smartfactorySoupImage;
      if (isReady) smartfactorySoupImage = skinUrl(SKIN.pot.ready);
      else if (count >= 3) smartfactorySoupImage = skinUrl(SKIN.pot.mat3);
      else if (count === 2) smartfactorySoupImage = skinUrl(SKIN.pot.mat2);
      else if (count === 1) smartfactorySoupImage = skinUrl(SKIN.pot.mat1);

      if (smartfactorySoupImage) {
        g.appendChild(this.createImageNode(smartfactorySoupImage, x * gridSize, y * gridSize, gridSize, gridSize, "xMidYMid slice", 1, null, !isReady ? POT_INGREDIENT_FILTER : null));
      }

      const key = `${x} ${y}`;
      const rem = remainingByKey[key];
      const logicalCooking = !isReady && count >= 3;
      const isCooking = obj.isCooking !== undefined ? obj.isCooking : logicalCooking;

      if (isCooking && typeof rem === "number") {
        remainingTime = rem;
        cooking = rem > 0;
      }

      if (isReady) {
        const ccx = x * gridSize + gridSize / 2 + 2;
        const ccy = y * gridSize + gridSize / 2;
        const checkG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        
        const c1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c1.setAttribute('cx', ccx); c1.setAttribute('cy', ccy); c1.setAttribute('r', 19); c1.setAttribute('fill', 'rgba(0,0,0,0.5)');
        checkG.appendChild(c1);

        const c2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c2.setAttribute('cx', ccx); c2.setAttribute('cy', ccy); c2.setAttribute('r', 16); c2.setAttribute('fill', 'none');
        c2.setAttribute('stroke', '#34c759'); c2.setAttribute('stroke-width', '4');
        checkG.appendChild(c2);

        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', `M ${ccx - 7} ${ccy} l 5 6 l 10 -12`);
        p.setAttribute('fill', 'none'); p.setAttribute('stroke', '#fff'); p.setAttribute('stroke-width', '3');
        p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
        checkG.appendChild(p);

        g.appendChild(checkG);
      }

      if (cooking && remainingTime !== null) {
        const r = 16;
        const sw = 4;
        const cx = x * gridSize + gridSize / 2 + 2;
        const cy = y * gridSize + gridSize / 2;
        const circumference = 2 * Math.PI * r;
        const progress = 1 - remainingTime / cookTotalForBar;
        const dashOffset = circumference * (1 - progress);

        const timerG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const cBg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        cBg.setAttribute('cx', cx); cBg.setAttribute('cy', cy); cBg.setAttribute('r', r + 3); cBg.setAttribute('fill', 'rgba(0,0,0,0.5)');
        timerG.appendChild(cBg);

        const cRing = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        cRing.setAttribute('cx', cx); cRing.setAttribute('cy', cy); cRing.setAttribute('r', r);
        cRing.setAttribute('fill', 'none'); cRing.setAttribute('stroke', 'rgba(255,255,255,0.15)'); cRing.setAttribute('stroke-width', sw);
        timerG.appendChild(cRing);

        const cProg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        cProg.setAttribute('cx', cx); cProg.setAttribute('cy', cy); cProg.setAttribute('r', r);
        cProg.setAttribute('fill', 'none');
        cProg.setAttribute('stroke', progress < 0.5 ? "#ff9500" : progress < 0.85 ? "#ffcc00" : "#34c759");
        cProg.setAttribute('stroke-width', sw); cProg.setAttribute('stroke-linecap', 'round');
        cProg.setAttribute('stroke-dasharray', circumference); cProg.setAttribute('stroke-dashoffset', dashOffset);
        cProg.setAttribute('transform', `rotate(-90 ${cx} ${cy})`);
        timerG.appendChild(cProg);

        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('x', cx); txt.setAttribute('y', cy + 5);
        txt.setAttribute('text-anchor', 'middle'); txt.setAttribute('font-size', '14'); txt.setAttribute('font-weight', 'bold');
        txt.setAttribute('font-family', 'monospace'); txt.setAttribute('fill', '#fff');
        txt.setAttribute('stroke', '#000'); txt.setAttribute('stroke-width', '2'); txt.setAttribute('paint-order', 'stroke');
        txt.style.strokeLinejoin = "round";
        txt.textContent = Math.ceil(remainingTime);
        timerG.appendChild(txt);

        g.appendChild(timerG);
      }

      return g;
    }

    if ((obj.name === "onion" || obj.name === "tomato") && cell !== "P") {
      g.appendChild(this.createImageNode(skinUrl(SKIN.itemOnCounter.ingredient), x * gridSize, y * gridSize, gridSize, gridSize, "xMidYMid slice", 1, null, INGREDIENT_FILTER));
      return g;
    }

    if (obj.name === "dish" && cell !== "P") {
      g.appendChild(this.createImageNode(skinUrl(SKIN.itemOnCounter.dish), x * gridSize, y * gridSize, gridSize, gridSize, "xMidYMid slice"));
      return g;
    }

    // Fallback sprite render if needed
    let category = "objects";
    let frameName = `${obj.name}.png`;
    const sp = this.renderSprite(category, frameName, x * gridSize, y * gridSize, gridSize, obj.isReady ? 1 : 0.85);
    if (sp) g.appendChild(sp);

    return g;
  }

  renderPlayer(player, index, targetPlayer, playerInterpolationProgress) {
    const { x, y } = player.position;
    const targetX = targetPlayer?.position?.x ?? x;
    const targetY = targetPlayer?.position?.y ?? y;
    const movementDistance = Math.abs(targetX - x) + Math.abs(targetY - y);
    const canInterpolateMove = movementDistance <= 1.01;
    const movementProgress = canInterpolateMove ? playerInterpolationProgress : 0;

    const interpX = lerp(x, targetX, movementProgress);
    const interpY = lerp(y, targetY, movementProgress);

    const scale = 1.25;
    const offset = (gridSize * (scale - 1)) / 2;

    const orientationPlayer = movementProgress > 0.15 ? targetPlayer : player;
    const rawOrientation = orientationPlayer.orientation || player.orientation || "south";
    const orientation = this.normalizeDir(rawOrientation);

    const held = player.heldObject?.name;
    const heldLower = (held || "").toLowerCase();

    const colorIndex = index % SKIN.chef.sideColor.length;
    const frontColor = skinUrl(SKIN.chef.frontColor[colorIndex]);
    const sideColor = skinUrl(SKIN.chef.sideColor[colorIndex]);
    const chefFront = skinUrl(SKIN.chef.front);
    const chefSide = skinUrl(SKIN.chef.side);

    let chefImage = chefFront;
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

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `translate(${interpX * gridSize - offset}, ${interpY * gridSize - offset}) scale(${scale})`);

    const imgChef = this.createImageNode(chefImage, 0, 0, gridSize, gridSize, "none", 1, chefFlip || null);
    imgChef.style.imageRendering = "auto";
    g.appendChild(imgChef);

    const isSideView = orientation === "WEST" || orientation === "EAST";
    let heldAsset = null;
    if (heldLower === "onion" || heldLower === "tomato") {
      heldAsset = skinUrl(isSideView ? SKIN.held.ingredientSide : SKIN.held.ingredientFront);
    } else if (heldLower === "dish") {
      heldAsset = skinUrl(isSideView ? SKIN.held.dishSide : SKIN.held.dishFront);
    } else if (heldLower.includes("soup")) {
      heldAsset = skinUrl(isSideView ? SKIN.held.soupSide : SKIN.held.soupFront);
    }

    if (heldAsset) {
      const isIngredient = heldLower.includes("onion") || heldLower.includes("tomato");
      const imgHeld = this.createImageNode(heldAsset, 0, 0, gridSize, gridSize, "none", 1, chefFlip || null, isIngredient ? HELD_INGREDIENT_FILTER : null);
      imgHeld.style.imageRendering = "auto";
      g.appendChild(imgHeld);
    }

    const isFrontView = orientation === "NORTH" || orientation === "SOUTH";
    const colorOffsetX = isFrontView ? -2 : 0;
    const imgColor = this.createImageNode(colorOverlay, colorOffsetX, 0, gridSize, gridSize, "none", 1, colorFlip || null);
    imgColor.style.imageRendering = "auto";
    g.appendChild(imgColor);

    return g;
  }

  render(staticInfo, frame, frames, frameIndex, elapsed = null, frameDuration = 0.45) {
    const { grid, width, height } = staticInfo;
    const boardWidth = width * gridSize;
    const boardHeight = height * gridSize;

    // Set viewBox with padding matching OvercookScene.jsx (-gridSize * 0.3)
    this.svg.setAttribute('viewBox', `${-gridSize * 0.3} ${-gridSize * 0.3} ${boardWidth + gridSize * 0.6} ${boardHeight + gridSize * 0.6}`);

    // 1. Render static background (only re-render if layout changed or empty)
    if (!this.lastLayoutName || this.lastLayoutName !== staticInfo.layoutName || this.bgGroup.childNodes.length === 0) {
      this.bgGroup.innerHTML = '';
      this.bgGroup.appendChild(this.renderBackgroundTiles(staticInfo));
      this.lastLayoutName = staticInfo.layoutName;
    }

    // 2. Cooking timer calculation
    const remainingByKey = {};
    if (frames && frames.length > 0) {
      frames.forEach((f) => {
        if (f.timestep > frame.timestep) return;
        const objectsFound = f.objects ? f.objects : [];
        const realObjects = Array.isArray(objectsFound) ? objectsFound : Object.values(objectsFound || {});
        realObjects.forEach((obj) => {
          if (obj.name === "soup") {
            const count = obj.numIngredients ?? obj.ingredients?.length ?? 0;
            const isCooking = !obj.isReady && count >= 3;
            const key = `${obj.position.x} ${obj.position.y}`;
            const cookTotal = obj.cookTime ?? staticInfo.cookTime ?? 20;

            if (isCooking) {
              if (remainingByKey[key] === undefined) remainingByKey[key] = cookTotal;
              else if (remainingByKey[key] > 0) remainingByKey[key] -= 1;
            } else {
              remainingByKey[key] = obj.isReady ? 0 : cookTotal;
            }
          }
        });
      });
    }

    // 3. Render Objects
    this.objGroup.innerHTML = '';
    const objectsFound = frame.objects ? frame.objects : [];
    const realObjects = Array.isArray(objectsFound) ? objectsFound : Object.values(objectsFound || {});
    const cookTotalForBar = staticInfo.cookTime ?? 20;

    realObjects.forEach((obj) => {
      const objNode = this.renderObject(staticInfo, frame, obj, remainingByKey, cookTotalForBar);
      if (objNode) this.objGroup.appendChild(objNode);
    });

    // 4. Render Players (with smooth interpolation)
    this.playerGroup.innerHTML = '';
    const frameArray = Array.isArray(frames) ? frames : [];
    const fallbackFrameIndex = Math.max(frameArray.indexOf(frame), 0);
    const resolvedFrameIndex = Number.isInteger(frameIndex) && frameIndex >= 0 ? frameIndex : fallbackFrameIndex;
    const exactFramePosition = Number.isFinite(elapsed) && frameDuration > 0 ? elapsed / frameDuration : resolvedFrameIndex;
    const maxFrameIndex = Math.max(frameArray.length - 1, 0);
    const clampedFramePosition = clamp(exactFramePosition, 0, maxFrameIndex);
    const playerSourceIndex = clamp(Math.floor(clampedFramePosition), 0, maxFrameIndex);
    const playerTargetIndex = Math.min(playerSourceIndex + 1, maxFrameIndex);
    const playerFrame = frameArray[playerSourceIndex] || frame;
    const playerTargetFrame = frameArray[playerTargetIndex] || playerFrame;
    const playerInterpolationProgress = playerTargetIndex !== playerSourceIndex ? snapEase(clamp(clampedFramePosition - playerSourceIndex, 0, 1)) : 0;

    (playerFrame.players || []).forEach((p, index) => {
      const playerKey = p.id ?? p.playerId ?? p.name ?? `player-${index}`;
      const targetPlayer = playerTargetFrame?.players?.find((c, ci) => (c.id ?? c.playerId ?? c.name ?? `player-${ci}`) === playerKey) || playerTargetFrame?.players?.[index] || p;
      const playerNode = this.renderPlayer(p, index, targetPlayer, playerInterpolationProgress);
      if (playerNode) this.playerGroup.appendChild(playerNode);
    });
  }
}
