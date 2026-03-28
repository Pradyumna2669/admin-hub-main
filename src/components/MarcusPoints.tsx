import React, { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { MeshSurfaceSampler } from "three/addons/math/MeshSurfaceSampler.js";

type MarcusPointsSize = "default" | "compact";

type MarcusPointCloudProps = {
  size: MarcusPointsSize;
};

function MarcusPointCloud({ size }: MarcusPointCloudProps) {
  const group = useRef<THREE.Group>(null!);
  const { scene } = useGLTF("/marcus.glb");

  const isMobile =
    typeof window !== "undefined" && window.innerWidth < 768;

  // Extract first mesh
  const mesh = useMemo(() => {
    let found: THREE.Mesh | null = null;
    scene.traverse((child: any) => {
      if (child.isMesh && !found) found = child;
    });
    return found;
  }, [scene]);

  const pointsGeometry = useMemo(() => {
    if (!mesh) return null;

    const geometry = mesh.geometry.clone();

    // Center geometry
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const center = new THREE.Vector3();
    box.getCenter(center);
    geometry.translate(-center.x, -center.y, -center.z);

    const sampler = new MeshSurfaceSampler(
      new THREE.Mesh(geometry)
    ).build();

    const positions: number[] = [];
    const tempPosition = new THREE.Vector3();

    const sampleCount = isMobile ? 6500 : 9000;

    for (let i = 0; i < sampleCount; i++) {
      sampler.sample(tempPosition);
      positions.push(tempPosition.x, tempPosition.y, tempPosition.z);
    }

    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );

    return pointGeometry;
  }, [mesh, isMobile]);

  // Smooth vertical spin
  useFrame(() => {
    if (group.current) {
      group.current.rotation.y += 0.0023;
    }
  });

  if (!pointsGeometry) return null;

  const scale =
    size === "compact"
      ? isMobile
        ? 0.22
        : 0.28
      : isMobile
        ? 0.26
        : 0.32;

  const pointSize =
    size === "compact"
      ? isMobile
        ? 0.006
        : 0.008
      : isMobile
        ? 0.007
        : 0.009;

  return (
    <group
      ref={group}
      scale={scale}
    >
      <points geometry={pointsGeometry}>
        <pointsMaterial
          size={pointSize}
          color="#8b5cf6"
          transparent
          opacity={0.9}
          depthWrite={false}
        />
      </points>
    </group>
  );
}

type MarcusPointsProps = {
  size?: MarcusPointsSize;
};

export default function MarcusPoints({ size = "default" }: MarcusPointsProps) {
  const canvasStyle =
    size === "compact"
      ? {
          height: "50vh",
          maxHeight: "520px",
          minHeight: "360px",
          width: "100%",
        }
      : {
          height: "60vh",
          maxHeight: "650px",
          minHeight: "480px",
          width: "100%",
        };

  return (
    <Canvas
      dpr={[1, 1.5]} // DPI consistency across monitors
      camera={{
        position: [0, 0, 3],
        fov: 45, // lower FOV = consistent perspective
      }}
      gl={{
        antialias: true,
        powerPreference: "high-performance",
      }}
      style={canvasStyle}
    >
      <ambientLight intensity={0.6} />
      <MarcusPointCloud size={size} />
    </Canvas>
  );
}
