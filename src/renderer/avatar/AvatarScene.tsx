import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import type { AvatarActivityState, EmotionType, MoodType } from "../../shared/types/index";
import type { AudioPipeline } from "../audio/AudioPipeline";
import type { AvatarGestureType } from "./AvatarController";
import { Nika2DAvatar } from "./Nika2DAvatar";

interface AvatarSceneProps {
  avatarBase64: string | null;
  avatarState: AvatarActivityState;
  emotion: EmotionType;
  mood?: MoodType;
  gestureSignal?: { type: AvatarGestureType; seq: number } | null;
  audioPipeline: AudioPipeline;
}

function ProceduralAnimeFallback({
  avatarState,
  emotion,
  audioPipeline
}: {
  avatarState: AvatarActivityState;
  emotion: EmotionType;
  audioPipeline: AudioPipeline;
}) {
  const headRef = useRef<THREE.Group>(null);
  const mouthRef = useRef<THREE.Mesh>(null);
  const leftEyeRef = useRef<THREE.Mesh>(null);
  const rightEyeRef = useRef<THREE.Mesh>(null);
  const blinkTimer = useRef(0);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const mouth = audioPipeline.getMouthMetrics();

    if (headRef.current) {
      const targetRotY = state.pointer.x * 0.25 + (avatarState === "talking" ? Math.sin(t * 3.5) * 0.05 : 0);
      const targetRotX =
        -state.pointer.y * 0.15 +
        (avatarState === "thinking" ? -0.1 : avatarState === "listening" ? 0.06 : Math.sin(t * 1.4) * 0.03);
      headRef.current.rotation.y = THREE.MathUtils.lerp(headRef.current.rotation.y, targetRotY, delta * 6);
      headRef.current.rotation.x = THREE.MathUtils.lerp(headRef.current.rotation.x, targetRotX, delta * 6);
      headRef.current.position.y = 1.2 + Math.sin(t * 2) * 0.025;
    }

    if (mouthRef.current) {
      const openScale = avatarState === "talking" ? 0.35 + mouth.aa * 2.2 : emotion === "laugh" ? 1.3 : 0.2;
      mouthRef.current.scale.y = THREE.MathUtils.lerp(mouthRef.current.scale.y, openScale, delta * 18);
    }

    blinkTimer.current += delta;
    const isBlinking = blinkTimer.current > 3.6 && blinkTimer.current < 3.76;
    if (blinkTimer.current >= 3.76) blinkTimer.current = 0;
    const eyeScaleY = isBlinking ? 0.08 : emotion === "happy" || emotion === "laugh" ? 0.55 : 1;
    if (leftEyeRef.current && rightEyeRef.current) {
      leftEyeRef.current.scale.y = THREE.MathUtils.lerp(leftEyeRef.current.scale.y, eyeScaleY, delta * 20);
      rightEyeRef.current.scale.y = THREE.MathUtils.lerp(rightEyeRef.current.scale.y, eyeScaleY, delta * 20);
    }
  });

  const auraColor = useMemo(() => {
    switch (emotion) {
      case "happy":
      case "laugh":
        return "#22d3ee";
      case "angry":
        return "#fb7185";
      case "sad":
        return "#60a5fa";
      case "surprised":
        return "#facc15";
      default:
        return "#a855f7";
    }
  }, [emotion]);

  return (
    <group>
      {/* Stylized Anime Holo-Companion Bust */}
      <mesh position={[0, 0.35, 0]}>
        <cylinderGeometry args={[0.26, 0.42, 0.9, 32]} />
        <meshStandardMaterial color="#1f1238" metalness={0.4} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.35, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.45, 0.015, 16, 48]} />
        <meshBasicMaterial color={auraColor} />
      </mesh>

      <group ref={headRef} position={[0, 1.2, 0]}>
        <mesh>
          <sphereGeometry args={[0.42, 32, 32]} />
          <meshStandardMaterial color="#fce7f3" roughness={0.55} />
        </mesh>
        {/* Hair cap */}
        <mesh position={[0, 0.1, -0.04]}>
          <sphereGeometry args={[0.445, 32, 32, 0, Math.PI * 2, 0, Math.PI * 0.58]} />
          <meshStandardMaterial color="#4c1d95" roughness={0.4} />
        </mesh>
        {/* Cyan cyber headset */}
        <mesh position={[-0.43, 0.04, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.1, 0.1, 0.06, 20]} />
          <meshStandardMaterial color="#22d3ee" emissive="#22d3ee" emissiveIntensity={0.6} />
        </mesh>
        <mesh position={[0.43, 0.04, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.1, 0.1, 0.06, 20]} />
          <meshStandardMaterial color="#22d3ee" emissive="#22d3ee" emissiveIntensity={0.6} />
        </mesh>
        {/* Eyes */}
        <mesh ref={leftEyeRef} position={[-0.14, 0.02, 0.39]}>
          <sphereGeometry args={[0.055, 16, 16]} />
          <meshStandardMaterial color="#22d3ee" emissive="#06b6d4" emissiveIntensity={0.8} />
        </mesh>
        <mesh ref={rightEyeRef} position={[0.14, 0.02, 0.39]}>
          <sphereGeometry args={[0.055, 16, 16]} />
          <meshStandardMaterial color="#22d3ee" emissive="#06b6d4" emissiveIntensity={0.8} />
        </mesh>
        {/* Mouth */}
        <mesh ref={mouthRef} position={[0, -0.15, 0.39]}>
          <boxGeometry args={[0.11, 0.04, 0.03]} />
          <meshStandardMaterial color="#f43f5e" />
        </mesh>
      </group>
    </group>
  );
}

function VRMModel({
  avatarBase64,
  avatarState,
  emotion,
  audioPipeline
}: AvatarSceneProps) {
  const { scene } = useThree();
  const [vrm, setVrm] = useState<VRM | null>(null);
  const [rawGroup, setRawGroup] = useState<THREE.Object3D | null>(null);
  const blinkRef = useRef({ timer: 0, nextBlink: 3.2 });
  const smoothMouth = useRef({ aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 });

  useEffect(() => {
    if (!avatarBase64) {
      setVrm(null);
      setRawGroup(null);
      return;
    }

    let cancelled = false;
    const binary = atob(avatarBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: "model/gltf-binary" });
    const url = URL.createObjectURL(blob);

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    loader.load(
      url,
      (gltf) => {
        if (cancelled) return;
        const loadedVrm = gltf.userData.vrm as VRM | undefined;
        if (loadedVrm) {
          VRMUtils.removeUnnecessaryVertices(gltf.scene);
          VRMUtils.combineSkeletons(gltf.scene);
          loadedVrm.scene.rotation.y = Math.PI;
          setVrm(loadedVrm);
          setRawGroup(null);
        } else {
          setVrm(null);
          setRawGroup(gltf.scene);
        }
        URL.revokeObjectURL(url);
      },
      undefined,
      (err) => {
        console.error("Failed to load VRM/GLB:", err);
        URL.revokeObjectURL(url);
      }
    );

    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [avatarBase64, scene]);

  useFrame((state, delta) => {
    if (!vrm) return;
    const t = state.clock.elapsedTime;
    const exp = vrm.expressionManager;

    // 1. Lip-sync
    const mouth = audioPipeline.getMouthMetrics();
    const targetAa = avatarState === "talking" ? mouth.aa : 0;
    const targetIh = avatarState === "talking" ? mouth.ih : 0;
    const targetOu = avatarState === "talking" ? mouth.ou : 0;
    const targetEe = avatarState === "talking" ? mouth.ee : 0;
    const targetOh = avatarState === "talking" ? mouth.oh : 0;

    const lerpRate = Math.min(1, delta * 18);
    smoothMouth.current.aa = THREE.MathUtils.lerp(smoothMouth.current.aa, targetAa, lerpRate);
    smoothMouth.current.ih = THREE.MathUtils.lerp(smoothMouth.current.ih, targetIh, lerpRate);
    smoothMouth.current.ou = THREE.MathUtils.lerp(smoothMouth.current.ou, targetOu, lerpRate);
    smoothMouth.current.ee = THREE.MathUtils.lerp(smoothMouth.current.ee, targetEe, lerpRate);
    smoothMouth.current.oh = THREE.MathUtils.lerp(smoothMouth.current.oh, targetOh, lerpRate);

    if (exp) {
      exp.setValue("aa", smoothMouth.current.aa);
      exp.setValue("ih", smoothMouth.current.ih);
      exp.setValue("ou", smoothMouth.current.ou);
      exp.setValue("ee", smoothMouth.current.ee);
      exp.setValue("oh", smoothMouth.current.oh);

      // 2. Blinking
      blinkRef.current.timer += delta;
      let blinkVal = 0;
      if (blinkRef.current.timer > blinkRef.current.nextBlink) {
        const elapsed = blinkRef.current.timer - blinkRef.current.nextBlink;
        if (elapsed < 0.14) {
          blinkVal = Math.sin((elapsed / 0.14) * Math.PI);
        } else {
          blinkRef.current.timer = 0;
          blinkRef.current.nextBlink = 2.4 + Math.random() * 2.8;
        }
      }
      exp.setValue("blink", blinkVal);

      // 3. Emotion expression
      exp.setValue("happy", emotion === "happy" || emotion === "laugh" ? 0.85 : 0);
      exp.setValue("sad", emotion === "sad" ? 0.85 : 0);
      exp.setValue("angry", emotion === "angry" ? 0.85 : 0);
      exp.setValue("surprised", emotion === "surprised" ? 0.85 : 0);
      exp.setValue("relaxed", emotion === "neutral" ? 0.25 : 0);
    }

    // 4. Procedural head & idle animation + eye tracking
    const head = vrm.humanoid?.getNormalizedBoneNode("head");
    const spine = vrm.humanoid?.getNormalizedBoneNode("spine");
    if (head) {
      const targetY = state.pointer.x * 0.25 + (avatarState === "talking" ? Math.sin(t * 3.1) * 0.05 : 0);
      const targetX =
        -state.pointer.y * 0.12 +
        (avatarState === "thinking" ? -0.12 : avatarState === "listening" ? 0.05 : Math.sin(t * 1.2) * 0.025);
      head.rotation.y = THREE.MathUtils.lerp(head.rotation.y, targetY, delta * 5);
      head.rotation.x = THREE.MathUtils.lerp(head.rotation.x, targetX, delta * 5);
    }
    if (spine) {
      spine.rotation.x = Math.sin(t * 1.5) * 0.015;
    }

    if (vrm.lookAt) {
      vrm.lookAt.target = state.camera;
    }

    vrm.update(delta);
  });

  if (vrm) {
    return <primitive object={vrm.scene} position={[0, -0.1, 0]} />;
  }
  if (rawGroup) {
    return <primitive object={rawGroup} position={[0, -0.1, 0]} />;
  }
  return (
    <ProceduralAnimeFallback
      avatarState={avatarState}
      emotion={emotion}
      audioPipeline={audioPipeline}
    />
  );
}

export const AvatarScene: React.FC<AvatarSceneProps> = (props) => {
  if (!props.avatarBase64) {
    return (
      <Nika2DAvatar
        avatarState={props.avatarState}
        emotion={props.emotion}
        mood={props.mood}
        gestureSignal={props.gestureSignal}
        audioPipeline={props.audioPipeline}
      />
    );
  }

  return (
    <Canvas camera={{ position: [0, 1.35, 1.8], fov: 35 }} shadows>
      <color attach="background" args={["#07040f"]} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[2, 3, 2]} intensity={1.4} color="#e9d5ff" />
      <pointLight position={[-2, 1.5, 1.5]} intensity={1.1} color="#22d3ee" />
      <pointLight position={[2, 1.2, -1]} intensity={0.9} color="#a855f7" />
      <VRMModel {...props} />
      <OrbitControls target={[0, 1.2, 0]} enablePan={false} minDistance={0.9} maxDistance={3.2} />
    </Canvas>
  );
};
