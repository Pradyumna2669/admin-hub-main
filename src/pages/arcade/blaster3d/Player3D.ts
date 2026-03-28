import * as THREE from "three";
import { worldToScene } from "./Matchmaking";

export type RemoteVisual = {
  root: THREE.Group;
  healthBar: THREE.Mesh;
  label: THREE.Sprite;
};

const makeLabel = (text: string) => {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas label context missing");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(8,15,26,0.85)";
  ctx.fillRect(0, 10, 256, 40);
  ctx.fillStyle = "#f8fafc";
  ctx.font = "bold 28px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(text.slice(0, 16), 128, 38);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.8, 0.45, 1);
  sprite.position.set(0, 2.2, 0);
  return sprite;
};

export const createPlayerVisual = (name: string, color = 0xfb7185): RemoteVisual => {
  const root = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.32, 0.9, 4, 8),
    new THREE.MeshBasicMaterial({ color }),
  );
  body.position.y = 0.95;

  const gun = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.12, 0.55),
    new THREE.MeshBasicMaterial({ color: 0x111827 }),
  );
  gun.position.set(0.25, 1.2, 0.08);
  gun.rotation.y = Math.PI / 2;

  const healthBack = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.08),
    new THREE.MeshBasicMaterial({ color: 0x111827 }),
  );
  healthBack.position.set(0, 1.95, 0);

  const healthBar = new THREE.Mesh(
    new THREE.PlaneGeometry(0.86, 0.05),
    new THREE.MeshBasicMaterial({ color: 0x22c55e }),
  );
  healthBar.position.set(0, 1.95, 0.01);

  const label = makeLabel(name);

  root.add(body, gun, healthBack, healthBar, label);
  return { root, healthBar, label };
};

export const updatePlayerVisual = (
  visual: RemoteVisual,
  next: { x: number; y: number; angle: number; health: number },
  lerp = 0.22,
) => {
  const target = worldToScene(next.x, next.y, 0);
  visual.root.position.lerp(target, lerp);
  visual.root.rotation.y += (next.angle - visual.root.rotation.y) * 0.28;
  visual.healthBar.scale.x = Math.max(0.06, next.health / 100);
  visual.healthBar.position.x = -(0.86 - 0.86 * visual.healthBar.scale.x) / 2;
};
