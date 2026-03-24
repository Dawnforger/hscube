const FACE_COLORS = {
  U: "#f7f9fb",
  R: "#ff5555",
  F: "#00a86b",
  D: "#ffd33d",
  L: "#ff8c42",
  B: "#4f74ff",
};

const FACE_ORDER = ["U", "R", "F", "D", "L", "B"];
const SOLVED_FACELETS = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";
const FACE_LABELS = {
  U: "U",
  R: "R",
  F: "F",
  D: "D",
  L: "L",
  B: "B",
};

export function createCubeRenderer(container) {
  const root = document.createElement("div");
  root.className = "cube-net-root";

  const net = document.createElement("div");
  net.className = "cube-net";
  root.append(net);

  const stickers = new Map();
  for (const face of FACE_ORDER) {
    const faceCard = document.createElement("section");
    faceCard.className = `cube-face cube-face-${face.toLowerCase()}`;

    const label = document.createElement("h3");
    label.className = "cube-face-label";
    label.textContent = FACE_LABELS[face];

    const grid = document.createElement("div");
    grid.className = "cube-face-grid";
    grid.setAttribute("role", "img");
    grid.setAttribute("aria-label", `${face} face`);

    for (let stickerIndex = 0; stickerIndex < 9; stickerIndex += 1) {
      const sticker = document.createElement("div");
      sticker.className = "cube-sticker";
      grid.append(sticker);
      stickers.set(`${face}${stickerIndex}`, sticker);
    }

    faceCard.append(label, grid);
    net.append(faceCard);
  }

  container.replaceChildren(root);
  applyFacelets(stickers, SOLVED_FACELETS);

  return {
    updateFromFacelets(facelets) {
      applyFacelets(stickers, facelets);
    },
    destroy() {
      container.replaceChildren();
    },
  };
}

function applyFacelets(stickers, facelets) {
  if (typeof facelets !== "string" || facelets.length < 54) {
    return;
  }

  for (let faceIndex = 0; faceIndex < FACE_ORDER.length; faceIndex += 1) {
    const face = FACE_ORDER[faceIndex];
    for (let sticker = 0; sticker < 9; sticker += 1) {
      const key = `${face}${sticker}`;
      const stickerElement = stickers.get(key);
      if (!stickerElement) {
        continue;
      }

      const colorKey = facelets[faceIndex * 9 + sticker];
      stickerElement.style.backgroundColor = FACE_COLORS[colorKey] ?? "#3b414f";
    }
  }
}
