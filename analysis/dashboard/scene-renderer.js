const CHEF_HAT_VARIANTS = ["bluehat", "greenhat", "orangehat", "purplehat", "redhat"];
const gridSize = 80;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

const HOLD_RATIO = 0.4;
function snapEase(t) {
  if (t < HOLD_RATIO) return 0;
  const moved = (t - HOLD_RATIO) / (1 - HOLD_RATIO);
  return 1 - (1 - moved) * (1 - moved);
}

const SOURCE_SIZES = {
  chefs: { w: 119, h: 119 },
  objects: { w: 255, h: 17 },
  terrain: { w: 119, h: 17 },
  soups: { w: 405, h: 15 },
};

const tileMap = {
  "X": "counter.png", " ": "floor.png", "P": "pot.png",
  "S": "serve.png", "O": "onions.png", "D": "dishes.png", "T": "tomatoes.png"
};

export class SceneRenderer {
  constructor(container) {
    this.container = container;
    this.spritesData = null;
    
    // Create main SVG
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.style.border = "2px solid #999";
    this.svg.style.background = "#d6c7a1";
    this.svg.style.borderRadius = "8px";
    this.svg.style.imageRendering = "pixelated";
    this.svg.style.width = "100%";
    this.svg.style.height = "100%";
    this.svg.style.maxWidth = "100%";
    this.svg.style.maxHeight = "100%";
    this.svg.style.display = "block";
    
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
    
    // Main group
    this.mainGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.svg.appendChild(this.mainGroup);
    this.container.innerHTML = '';
    this.container.appendChild(this.svg);
  }

  async loadSprites() {
    if (this.spritesData) return;
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
    return frame.players.some((p) => {
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

  render(staticInfo, frame, frames, frameIndex, elapsed = null, frameDuration = 0.45) {
    if (!this.spritesData) return;
    this.mainGroup.innerHTML = '';
    
    const { grid, width, height } = staticInfo;
    const boardWidth = width * gridSize;
    const boardHeight = height * gridSize;
    this.svg.setAttribute('viewBox', `0 0 ${boardWidth} ${boardHeight}`);

    // Cooking timer calculation
    const remainingByKey = {};
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

    // 1. Render Background
    grid.forEach((row, y) => {
      [...row].forEach((cell, x) => {
        let frameName = tileMap[cell] || "floor.png";
        const isDispenser = ["P", "S", "O", "D", "T"].includes(cell);
        
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        if (isDispenser) {
          const c = this.renderSprite('terrain', 'counter.png', x * gridSize, y * gridSize, gridSize);
          if (c) g.appendChild(c);
        }
        const s = this.renderSprite('terrain', frameName, x * gridSize, y * gridSize, gridSize);
        if (s) g.appendChild(s);
        this.mainGroup.appendChild(g);
      });
    });

    // 2. Render Objects
    const combinedObjects = Array.isArray(frame.objects) ? frame.objects : [];
    combinedObjects.forEach((obj, index) => {
      if (this.isHeldByPlayer(frame, obj)) return;
      const { x, y } = obj.position;
      const cell = grid[y]?.[x];
      if (cell === "S") return;

      let category = "objects";
      let frameName = obj.name === "tomato" ? "tomato.png" : `${obj.name}.png`;
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
        
        cookTotalForBar = obj.cookTime ?? staticInfo.cookTime ?? 20;
        let state = isReady ? "done" : (isCooking ? "cooked" : "idle");
        if (onionCount === 0 && tomatoCount === 0) return;
        frameName = `soup_${state}_tomato_${tomatoCount}_onion_${onionCount}.png`;

        const key = `${x} ${y}`;
        const rem = remainingByKey[key];
        if (isCooking && typeof rem === "number") {
          remainingTime = rem;
          cooking = rem > 0;
        }
      }

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const s = this.renderSprite(category, frameName, x * gridSize, y * gridSize, gridSize, obj.isReady ? 1 : 0.85);
      if (s) g.appendChild(s);

      if (cooking && remainingTime !== null) {
        const barY = y * gridSize + 20;
        
        const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bgRect.setAttribute('x', x * gridSize + 20); bgRect.setAttribute('y', barY);
        bgRect.setAttribute('width', 40); bgRect.setAttribute('height', 6);
        bgRect.setAttribute('rx', 3); bgRect.setAttribute('fill', '#ff5555'); bgRect.setAttribute('opacity', 0.85);
        g.appendChild(bgRect);

        const fgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        fgRect.setAttribute('x', x * gridSize + 20); fgRect.setAttribute('y', barY);
        fgRect.setAttribute('width', 40 * (1 - remainingTime / cookTotalForBar)); fgRect.setAttribute('height', 6);
        fgRect.setAttribute('rx', 3); fgRect.setAttribute('fill', '#ffffff'); fgRect.setAttribute('opacity', 0.9);
        g.appendChild(fgRect);

        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('x', x * gridSize + gridSize / 2); txt.setAttribute('y', barY - 4);
        txt.setAttribute('text-anchor', 'middle'); txt.setAttribute('font-size', '12');
        txt.setAttribute('font-family', 'monospace'); txt.setAttribute('fill', '#ffffff');
        txt.textContent = Math.ceil(remainingTime);
        g.appendChild(txt);
      }
      this.mainGroup.appendChild(g);
    });

    // 3. Render Players
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

    const getPlayerKey = (player, index) => player?.id ?? player?.playerId ?? player?.name ?? `player-${index}`;
    const findTargetPlayer = (player, index) => {
      const playerKey = getPlayerKey(player, index);
      return playerTargetFrame?.players?.find((c, ci) => getPlayerKey(c, ci) === playerKey) || playerTargetFrame?.players?.[index] || player;
    };

    (playerFrame.players || []).forEach((player, index) => {
      const targetPlayer = findTargetPlayer(player, index);
      const { x, y } = player.position;
      const targetX = targetPlayer.position?.x ?? x;
      const targetY = targetPlayer.position?.y ?? y;
      const movementDistance = Math.abs(targetX - x) + Math.abs(targetY - y);
      const canInterpolateMove = movementDistance <= 1.01;
      const movementProgress = canInterpolateMove ? playerInterpolationProgress : 0;
      
      const interpX = lerp(x, targetX, movementProgress);
      const interpY = lerp(y, targetY, movementProgress);

      const isInitialFrame = frame.timestep === 0;
      const orientationPlayer = movementProgress > 0.15 ? targetPlayer : player;
      const rawOrientation = orientationPlayer.orientation || player.orientation || "south";
      const orientation = isInitialFrame ? "SOUTH" : this.normalizeDir(rawOrientation);
      const heldLower = (player.heldObject?.name || "").toLowerCase();
      
      let frameName = null;
      const hatVariant = CHEF_HAT_VARIANTS[index % CHEF_HAT_VARIANTS.length];
      const hatName = `${orientation}-${hatVariant}.png`;
      
      if (heldLower === "onion") frameName = `${orientation}-onion.png`;
      else if (heldLower === "dish") frameName = `${orientation}-dish.png`;
      else if (heldLower.includes("soup")) frameName = heldLower.includes("tomato") ? `${orientation}-soup-tomato.png` : `${orientation}-soup-onion.png`;
      else if (heldLower === "tomato") frameName = `${orientation}-tomato.png`;

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('transform', `translate(${interpX * gridSize}, ${interpY * gridSize})`);
      
      const base = this.renderSprite('chefs', `${orientation}.png`, 0, 0, gridSize);
      if (base) g.appendChild(base);
      if (frameName) {
        const held = this.renderSprite('chefs', frameName, 0, 0, gridSize);
        if (held) g.appendChild(held);
      }
      const hat = this.renderSprite('chefs', hatName, 0, 0, gridSize);
      if (hat) g.appendChild(hat);
      
      this.mainGroup.appendChild(g);
    });
  }
}
