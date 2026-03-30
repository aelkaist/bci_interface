const fs = require('fs');

const chefs = JSON.parse(fs.readFileSync('public/graphics/chefs.json', 'utf8')).frames;

// test rendering logic
const heldList = [null, "onion", "dish", "soup_onion", "tomato"];
const dirs = ["NORTH", "SOUTH", "EAST", "WEST", "UP", "DOWN", "[0,1]", "[0,-1]"];

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

let missing = 0;
dirs.forEach(raw => {
  const o = normalizeDir(raw);
  heldList.forEach(held => {
    [0, 1].forEach(index => {
      const heldLower = (held || "").toLowerCase();
      let frameName = `${o}.png`;
      if (heldLower === "onion") frameName = `${o}-onion.png`;
      else if (heldLower === "dish") frameName = `${o}-dish.png`;
      else if (heldLower.includes("soup")) frameName = heldLower.includes("tomato") ? `${o}-soup-tomato.png` : `${o}-soup-onion.png`;
      else if (heldLower === "tomato") frameName = `${o}-tomato.png`;
      else frameName = index === 0 ? `${o}-bluehat.png` : `${o}-greenhat.png`;

      if (!chefs[frameName]) {
        console.log("MISSING:", frameName);
        missing++;
      }
    });
  });
});
console.log("Total missing:", missing);
