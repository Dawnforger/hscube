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
  scene.background = new THREE.Color(0x121722);

  const camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / Math.max(container.clientHeight, 1),
    0.1,
    100,
  );
  camera.position.set(3.4, 3.0, 4.0);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.replaceChildren(renderer.domElement);

  const ambient = new THREE.AmbientLight(0xffffff, 0.72);
  scene.add(ambient);
  const dir = new THREE.DirectionalLight(0xffffff, 0.7);
  dir.position.set(5, 8, 6);
  scene.add(dir);

  const root = new THREE.Group();
  scene.add(root);

  const stickerMeshes = new Map();
  buildCube(root, stickerMeshes);

  root.rotation.x = -0.52;
  root.rotation.y = 0.69;

  let raf = null;
  let alive = true;
  const animate = () => {
    if (!alive) {
      return;
    }
    root.rotation.y += 0.0022;
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
  const defaultMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2e37,
    roughness: 0.62,
    metalness: 0.1,
  });

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 2.2, 2.2),
    new THREE.MeshStandardMaterial({
      color: 0x1a1e28,
      roughness: 0.9,
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
