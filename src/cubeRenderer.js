import * as THREE from "three";

const FACE_COLORS = {
  U: 0xffffff,
  R: 0xff5555,
  F: 0x00a86b,
  D: 0xffd33d,
  L: 0xff8c42,
  B: 0x4f74ff,
};

const FACE_ORDER = ["U", "R", "F", "D", "L", "B"];

export function createCubeRenderer(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b2334);

  const camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / Math.max(container.clientHeight, 1),
    0.1,
    100,
  );
  camera.position.set(3.4, 3.0, 4.0);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Stickers use MeshBasicMaterial; lighter mapping keeps plastics vivid on all GPUs.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.replaceChildren(renderer.domElement);

  const canvas = renderer.domElement;
  canvas.style.touchAction = "none";
  canvas.style.cursor = "grab";

  const ambient = new THREE.AmbientLight(0xffffff, 1.15);
  scene.add(ambient);
  const dir = new THREE.DirectionalLight(0xffffff, 1.05);
  dir.position.set(5, 8, 6);
  scene.add(dir);
  const fill = new THREE.DirectionalLight(0xcfe0ff, 0.55);
  fill.position.set(-4, 2, -3);
  scene.add(fill);

  const root = new THREE.Group();
  scene.add(root);

  const stickerMeshes = new Map();
  buildCube(root, stickerMeshes);

  root.rotation.x = -0.52;
  root.rotation.y = 0.69;

  const ROTATE_SPEED = 0.0055;
  const tiltLimit = Math.PI / 2 - 0.12;
  let dragPointerId = null;
  let lastX = 0;
  let lastY = 0;

  const onPointerDown = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    dragPointerId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grabbing";
  };

  const onPointerMove = (event) => {
    if (dragPointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    root.rotation.y += dx * ROTATE_SPEED;
    root.rotation.x += dy * ROTATE_SPEED;
    root.rotation.x = Math.max(-tiltLimit, Math.min(tiltLimit, root.rotation.x));
  };

  const endDrag = (event) => {
    if (dragPointerId !== event.pointerId) {
      return;
    }
    dragPointerId = null;
    canvas.releasePointerCapture(event.pointerId);
    canvas.style.cursor = "grab";
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  let raf = null;
  let alive = true;
  const animate = () => {
    if (!alive) {
      return;
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(animate);
  };
  animate();

  const resizeObserver = new ResizeObserver(() => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  });
  resizeObserver.observe(container);

  applyFacelets(stickerMeshes, "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB");

  return {
    updateFromFacelets(facelets) {
      applyFacelets(stickerMeshes, facelets);
    },
    destroy() {
      alive = false;
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", endDrag);
      canvas.removeEventListener("pointercancel", endDrag);
      if (raf) {
        cancelAnimationFrame(raf);
      }
      resizeObserver.disconnect();
      renderer.dispose();
    },
  };
}

function buildCube(root, stickerMeshes) {
  const spacing = 0.68;
  const size = 0.6;
  const planeOffset = 1.04;
  // BasicMaterial: sticker colors stay correct regardless of lighting / tone mapping.
  const defaultMaterial = new THREE.MeshBasicMaterial({ color: 0x8892a8 });

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 2.2, 2.2),
    new THREE.MeshStandardMaterial({
      color: 0x202735,
      roughness: 0.76,
      metalness: 0.02,
    }),
  );
  root.add(body);

  for (const face of FACE_ORDER) {
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        const key = `${face}${row}${col}`;
        const plane = new THREE.Mesh(
          new THREE.PlaneGeometry(size, size),
          defaultMaterial.clone(),
        );

        placeSticker(plane, face, row, col, spacing, planeOffset);
        root.add(plane);
        stickerMeshes.set(key, plane);
      }
    }
  }
}

function placeSticker(mesh, face, row, col, spacing, offset) {
  const x = (col - 1) * spacing;
  const y = (1 - row) * spacing;

  switch (face) {
    case "U":
      mesh.position.set(x, offset, -y);
      mesh.rotation.x = -Math.PI / 2;
      break;
    case "D":
      mesh.position.set(x, -offset, y);
      mesh.rotation.x = Math.PI / 2;
      break;
    case "F":
      mesh.position.set(x, y, offset);
      break;
    case "B":
      mesh.position.set(-x, y, -offset);
      mesh.rotation.y = Math.PI;
      break;
    case "R":
      mesh.position.set(offset, y, -x);
      mesh.rotation.y = -Math.PI / 2;
      break;
    case "L":
      mesh.position.set(-offset, y, x);
      mesh.rotation.y = Math.PI / 2;
      break;
    default:
      break;
  }
}

function applyFacelets(stickerMeshes, facelets) {
  if (typeof facelets !== "string" || facelets.length < 54) {
    return;
  }

  for (let faceIndex = 0; faceIndex < FACE_ORDER.length; faceIndex += 1) {
    const face = FACE_ORDER[faceIndex];
    for (let sticker = 0; sticker < 9; sticker += 1) {
      const row = Math.floor(sticker / 3);
      const col = sticker % 3;
      const key = `${face}${row}${col}`;
      const mesh = stickerMeshes.get(key);
      if (!mesh) {
        continue;
      }

      const colorKey = facelets[faceIndex * 9 + sticker];
      mesh.material.color.setHex(FACE_COLORS[colorKey] ?? 0x3b414f);
    }
  }
}
