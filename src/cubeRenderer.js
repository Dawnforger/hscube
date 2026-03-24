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
const ROTATE_SPEED = 0.34;
const MAX_TILT = 78;
const EPSILON = 1e-8;

export function createCubeRenderer(container) {
  const root = document.createElement("div");
  root.className = "cube3d-root";

  const scene = document.createElement("div");
  scene.className = "cube3d-scene";

  const cube = document.createElement("div");
  cube.className = "cube3d";
  scene.append(cube);
  root.append(scene);

  const stickers = new Map();
  for (const face of FACE_ORDER) {
    const faceElement = document.createElement("section");
    faceElement.className = `cube3d-face cube3d-face-${face.toLowerCase()}`;
    faceElement.setAttribute("aria-label", `${face} face`);

    for (let stickerIndex = 0; stickerIndex < 9; stickerIndex += 1) {
      const sticker = document.createElement("div");
      sticker.className = "cube3d-sticker";
      faceElement.append(sticker);
      stickers.set(`${face}${stickerIndex}`, sticker);
    }

    cube.append(faceElement);
  }

  container.replaceChildren(root);
  applyFacelets(stickers, SOLVED_FACELETS);

  let rotX = -24;
  let rotY = -36;
  let pointerId = null;
  let lastX = 0;
  let lastY = 0;
  let orientationSyncEnabled = false;
  let referenceSensorQuaternion = null;
  let referenceRenderQuaternion = null;

  renderRotation();

  const onPointerDown = (event) => {
    if (orientationSyncEnabled) {
      return;
    }
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    pointerId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    scene.setPointerCapture(event.pointerId);
    scene.classList.add("dragging");
  };

  const onPointerMove = (event) => {
    if (orientationSyncEnabled) {
      return;
    }
    if (pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;

    rotY += dx * ROTATE_SPEED;
    rotX -= dy * ROTATE_SPEED;
    rotX = Math.max(-MAX_TILT, Math.min(MAX_TILT, rotX));
    renderRotation();
  };

  const endDrag = (event) => {
    if (orientationSyncEnabled) {
      return;
    }
    if (pointerId !== event.pointerId) {
      return;
    }
    pointerId = null;
    scene.releasePointerCapture(event.pointerId);
    scene.classList.remove("dragging");
  };

  scene.addEventListener("pointerdown", onPointerDown);
  scene.addEventListener("pointermove", onPointerMove);
  scene.addEventListener("pointerup", endDrag);
  scene.addEventListener("pointercancel", endDrag);

  let rafId = null;
  const resizeObserver = new ResizeObserver(() => {
    applyCubeSize();
  });
  resizeObserver.observe(scene);
  applyCubeSize();

  return {
    updateFromFacelets(facelets) {
      applyFacelets(stickers, facelets);
    },
    setOrientationSyncEnabled(enabled) {
      const nextEnabled = Boolean(enabled);
      if (orientationSyncEnabled === nextEnabled) {
        return;
      }
      if (nextEnabled && pointerId !== null) {
        try {
          scene.releasePointerCapture(pointerId);
        } catch {
          // Pointer may already be released; ignore.
        }
        pointerId = null;
        scene.classList.remove("dragging");
      }
      orientationSyncEnabled = nextEnabled;
      referenceSensorQuaternion = null;
      referenceRenderQuaternion = null;
      scene.classList.toggle("sync-enabled", orientationSyncEnabled);
      if (!orientationSyncEnabled) {
        renderRotation();
      }
    },
    resetOrientationSyncReference() {
      referenceSensorQuaternion = null;
      referenceRenderQuaternion = null;
    },
    syncOrientationToQuaternion(quaternion) {
      if (!orientationSyncEnabled) {
        return false;
      }
      const normalized = normalizeQuaternion(quaternion);
      if (!normalized) {
        return false;
      }

      if (!referenceSensorQuaternion) {
        referenceSensorQuaternion = normalized;
        referenceRenderQuaternion = eulerToQuaternion(rotX, rotY);
      }

      const sensorDelta = multiplyQuaternions(
        normalized,
        invertQuaternion(referenceSensorQuaternion),
      );
      const target = multiplyQuaternions(sensorDelta, referenceRenderQuaternion);
      renderQuaternion(target);
      return true;
    },
    destroy() {
      scene.removeEventListener("pointerdown", onPointerDown);
      scene.removeEventListener("pointermove", onPointerMove);
      scene.removeEventListener("pointerup", endDrag);
      scene.removeEventListener("pointercancel", endDrag);
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      resizeObserver.disconnect();
      container.replaceChildren();
    },
  };

  function renderRotation() {
    cube.style.transform = `rotateX(${rotX}deg) rotateY(${rotY}deg)`;
  }

  function renderQuaternion(quaternion) {
    const normalized = normalizeQuaternion(quaternion);
    if (!normalized) {
      return;
    }
    const clampedW = Math.max(-1, Math.min(1, normalized.w));
    const angle = 2 * Math.acos(clampedW);
    const axisFactor = Math.sqrt(Math.max(0, 1 - clampedW * clampedW));
    if (axisFactor < EPSILON) {
      cube.style.transform = "rotate3d(0, 0, 1, 0rad)";
      return;
    }
    const axisX = normalized.x / axisFactor;
    const axisY = normalized.y / axisFactor;
    const axisZ = normalized.z / axisFactor;
    cube.style.transform = `rotate3d(${axisX}, ${axisY}, ${axisZ}, ${angle}rad)`;
  }

  function applyCubeSize() {
    if (rafId) {
      cancelAnimationFrame(rafId);
    }
    rafId = requestAnimationFrame(() => {
      rafId = null;
      const width = Math.max(1, scene.clientWidth);
      const height = Math.max(1, scene.clientHeight);
      const base = Math.min(width, height);
      // Scale below the full box so projected corners stay inside viewport.
      const cubeSize = Math.max(96, Math.min(170, Math.floor(base * 0.54)));
      cube.style.setProperty("--cube-size", `${cubeSize}px`);
    });
  }
}

function normalizeQuaternion(quaternion) {
  if (!quaternion || typeof quaternion !== "object") {
    return null;
  }
  const x = Number(quaternion.x);
  const y = Number(quaternion.y);
  const z = Number(quaternion.z);
  const w = Number(quaternion.w);
  if (![x, y, z, w].every((value) => Number.isFinite(value))) {
    return null;
  }
  const magnitude = Math.hypot(x, y, z, w);
  if (magnitude < EPSILON) {
    return null;
  }
  return {
    x: x / magnitude,
    y: y / magnitude,
    z: z / magnitude,
    w: w / magnitude,
  };
}

function multiplyQuaternions(left, right) {
  const a = normalizeQuaternion(left);
  const b = normalizeQuaternion(right);
  if (!a || !b) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }
  return normalizeQuaternion({
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  });
}

function invertQuaternion(quaternion) {
  const normalized = normalizeQuaternion(quaternion);
  if (!normalized) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }
  return {
    x: -normalized.x,
    y: -normalized.y,
    z: -normalized.z,
    w: normalized.w,
  };
}

function eulerToQuaternion(rotXDeg, rotYDeg) {
  const halfX = (rotXDeg * Math.PI) / 360;
  const halfY = (rotYDeg * Math.PI) / 360;
  const sinX = Math.sin(halfX);
  const cosX = Math.cos(halfX);
  const sinY = Math.sin(halfY);
  const cosY = Math.cos(halfY);
  return normalizeQuaternion({
    w: cosX * cosY,
    x: sinX * cosY,
    y: cosX * sinY,
    z: -sinX * sinY,
  });
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
