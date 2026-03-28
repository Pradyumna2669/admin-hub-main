import * as THREE from "three";

export class FPSCameraRig {
  yaw = 0;
  pitch = 0;
  bobPhase = 0;
  recoil = 0;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private weapon: THREE.Object3D,
  ) {}

  look(deltaX: number, deltaY: number, sensitivity = 0.0022) {
    this.yaw -= deltaX * sensitivity;
    this.pitch = Math.max(-1.25, Math.min(1.25, this.pitch - deltaY * sensitivity));
  }

  kick(amount = 0.05) {
    this.recoil = Math.min(0.22, this.recoil + amount);
  }

  update(position: THREE.Vector3, isMoving: boolean, dt: number) {
    if (isMoving) this.bobPhase += dt * 9;
    const bobX = isMoving ? Math.sin(this.bobPhase) * 0.025 : 0;
    const bobY = isMoving ? Math.abs(Math.cos(this.bobPhase * 2)) * 0.03 : 0;

    this.recoil = Math.max(0, this.recoil - dt * 2.7);

    this.camera.position.copy(position);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch - this.recoil * 0.45;

    this.weapon.position.set(0.32 + bobX, -0.3 - bobY - this.recoil * 0.18, -0.55 + this.recoil * 0.1);
    this.weapon.rotation.set(-0.12 - this.recoil * 0.7, 0.14, -0.04 - this.recoil * 0.2);
  }

  forwardPlanar() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
  }

  rightPlanar() {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();
  }
}
