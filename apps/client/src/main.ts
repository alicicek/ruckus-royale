import "./style.css";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import RAPIER from "@dimforge/rapier3d-compat";
import { Client as ColyseusClient, Room } from "colyseus.js";
import { Howl, Howler } from "howler";
import {
  INTERPOLATION_DELAY_MS,
  ROOM_NAME,
  SERVER_TICK_DT,
  SERVER_TICK_RATE,
  RAGDOLL_TORSO_HALF_HEIGHT,
  RAGDOLL_TORSO_RADIUS,
  RAGDOLL_HEAD_RADIUS,
  RAGDOLL_UPPER_ARM_HALF_LENGTH,
  RAGDOLL_LOWER_ARM_HALF_LENGTH,
  RAGDOLL_THIGH_HALF_LENGTH,
  RAGDOLL_SHIN_HALF_LENGTH,
  RAGDOLL_LIMB_RADIUS,
  USE_BLOB_VISUALS,
  USE_BEAN_MESH,
  BLOB_TORSO_HALF_HEIGHT,
  BLOB_TORSO_RADIUS,
  BLOB_HEAD_RADIUS,
  BLOB_UPPER_ARM_HALF_LENGTH,
  BLOB_LOWER_ARM_HALF_LENGTH,
  BLOB_THIGH_HALF_LENGTH,
  BLOB_SHIN_HALF_LENGTH,
  BLOB_LIMB_RADIUS,
  clamp,
  integrateMotion,
  type ArenaId,
  type HazardStateNet,
  type InputFrame,
  type MatchMode,
  type PlayerStateNet,
  type RenderTextPayload,
  type RoundEvent,
  type SnapshotNet,
} from "@ruckus/shared";
import { RagdollManager, type BoneName, type RagdollBoneTransform } from "./ragdoll";
import { ParticleManager } from "./particles";
import { CharacterLoader, REVERSE_BONE_MAP, REVERSE_BEAN_BONE_MAP, ANIM_MAP, BeanMeshLoader, type GameAnimState } from "./character-loader";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:2567";
const SERVER_HTTP_URL = SERVER_URL.replace(/^ws/i, "http");

const ARENA_LABELS: Record<ArenaId, string> = {
  cargo_rooftop: "Cargo Rooftop",
  ferry_deck: "Ferry Deck",
  factory_pit: "Factory Pit",
};

const MODE_LABELS: Record<MatchMode, string> = {
  online: "Online",
  solo: "Solo",
  practice: "Practice",
};

interface RoomInfoMessage {
  roomCode: string;
  mode: MatchMode;
  playerId: string;
}

interface RoomListResponse {
  rooms: Array<{
    roomId: string;
    metadata?: Record<string, unknown>;
  }>;
}

interface TimedState {
  atMs: number;
  state: PlayerStateNet;
}

interface PlayerVisual {
  group: THREE.Group;
  torso: THREE.Mesh;
  head: THREE.Mesh;
  leftArm: THREE.Mesh;
  rightArm: THREE.Mesh;
  leftForearm: THREE.Mesh;
  rightForearm: THREE.Mesh;
  leftThigh: THREE.Mesh;
  rightThigh: THREE.Mesh;
  leftShin: THREE.Mesh;
  rightShin: THREE.Mesh;
  emote: THREE.Mesh;
  color: THREE.Color;
  /** Map bone names to the mesh that represents them (fallback mode) */
  boneMeshes: Map<BoneName, THREE.Mesh>;
  /** Hit flash state */
  flashTimer: number;
  originalEmissives: Map<THREE.Mesh, THREE.Color>;
  /** GLTF character state (null = fallback capsule mode) */
  gltfGroup: THREE.Group | null;
  gltfBones: Map<BoneName, THREE.Bone> | null;
  gltfMeshes: THREE.SkinnedMesh[];
  mixer: THREE.AnimationMixer | null;
  currentAnim: GameAnimState | null;
  animActions: Map<string, THREE.AnimationAction>;
  oneShotTimer: number;
  displayYaw: number;
  /** Bean mesh state (null = not using bean mesh) */
  beanGroup: THREE.Group | null;
  beanBones: Map<BoneName, THREE.Bone> | null;
  beanMeshes: THREE.SkinnedMesh[];
}

const hashToHue = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33 + value.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
};

// Pre-allocated temp objects to avoid per-frame GC pressure
const _tmpMat4 = new THREE.Matrix4();
const _tmpVec3A = new THREE.Vector3();
const _tmpVec3B = new THREE.Vector3();
const _tmpQuatA = new THREE.Quaternion();
const _tmpQuatB = new THREE.Quaternion();
const _hitFlashColor = new THREE.Color(0xfff8e0);

/** Creates a 4-band gradient texture for cel-shading */
function createToonGradientMap(): THREE.DataTexture {
  const data = new Uint8Array([40, 120, 200, 255]);
  const texture = new THREE.DataTexture(data, 4, 1, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Patches MeshToonMaterial to add fresnel rim-light glow on edges */
function addFresnelRim(material: THREE.MeshToonMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <dithering_fragment>",
      `
      // Fresnel rim lighting
      vec3 viewDir = normalize(vViewPosition);
      vec3 worldNormal = normalize(vNormal);
      float fresnel = pow(1.0 - abs(dot(viewDir, worldNormal)), 2.5);
      gl_FragColor.rgb += vec3(0.55, 0.72, 0.9) * fresnel * 0.45;
      #include <dithering_fragment>
      `,
    );
  };
}

function toneWavDataUri(frequency: number, durationMs: number): string {
  const sampleRate = 22050;
  const samples = Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
  const dataSize = samples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < samples; i += 1) {
    const t = i / sampleRate;
    const envelope = Math.exp(-4.2 * t);
    const s = Math.sin(2 * Math.PI * frequency * t) * envelope;
    const clamped = Math.max(-1, Math.min(1, s));
    view.setInt16(44 + i * 2, clamped * 32767, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

class AudioBank {
  private readonly hit = new Howl({
    src: [toneWavDataUri(220, 100)],
    volume: 0.15,
  });

  private readonly heavy = new Howl({
    src: [toneWavDataUri(135, 140)],
    volume: 0.16,
  });

  private readonly knockout = new Howl({
    src: [toneWavDataUri(90, 260)],
    volume: 0.2,
  });

  private readonly round = new Howl({
    src: [toneWavDataUri(410, 220)],
    volume: 0.14,
  });

  private readonly grab = new Howl({
    src: [toneWavDataUri(330, 80)],
    volume: 0.12,
  });

  private readonly throwSfx = new Howl({
    src: [toneWavDataUri(180, 150)],
    volume: 0.18,
  });

  constructor() {
    Howler.volume(0.6);
  }

  unlock(): void {
    Howler.ctx?.resume().catch(() => undefined);
  }

  play(name: "hit" | "heavy" | "knockout" | "round" | "grab" | "throw"): void {
    switch (name) {
      case "hit":
        this.hit.play();
        break;
      case "heavy":
        this.heavy.play();
        break;
      case "knockout":
        this.knockout.play();
        break;
      case "round":
        this.round.play();
        break;
      case "grab":
        this.grab.play();
        break;
      case "throw":
        this.throwSfx.play();
        break;
    }
  }
}

class InputController {
  private readonly down = new Set<string>();
  private leftMouse = false;
  private rightMouse = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (event) => {
      this.down.add(event.code);
    });

    window.addEventListener("keyup", (event) => {
      this.down.delete(event.code);
    });

    window.addEventListener("blur", () => {
      this.down.clear();
      this.leftMouse = false;
      this.rightMouse = false;
    });

    this.canvas.addEventListener("mousedown", (event) => {
      if (event.button === 0) this.leftMouse = true;
      if (event.button === 2) this.rightMouse = true;
    });

    window.addEventListener("mouseup", (event) => {
      if (event.button === 0) this.leftMouse = false;
      if (event.button === 2) this.rightMouse = false;
    });

    this.canvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
    });
  }

  private key(...codes: string[]): boolean {
    return codes.some((code) => this.down.has(code));
  }

  sample(tick: number): InputFrame {
    const pad = navigator.getGamepads?.()[0];
    const padX = pad?.axes?.[0] ?? 0;
    const padZ = pad?.axes?.[1] ?? 0;

    const keyboardX = (this.key("KeyD", "ArrowRight") ? 1 : 0) - (this.key("KeyA", "ArrowLeft") ? 1 : 0);
    const keyboardZ = (this.key("KeyS", "ArrowDown") ? 1 : 0) - (this.key("KeyW", "ArrowUp") ? 1 : 0);

    const moveX = clamp(keyboardX + (Math.abs(padX) > 0.18 ? padX : 0), -1, 1);
    const moveZ = clamp(keyboardZ + (Math.abs(padZ) > 0.18 ? padZ : 0), -1, 1);

    const jump = this.key("Space") || Boolean(pad?.buttons?.[0]?.pressed);
    const grab = this.key("KeyE") || Boolean(pad?.buttons?.[5]?.pressed);
    const lightAttack = this.key("KeyJ") || this.leftMouse || Boolean(pad?.buttons?.[2]?.pressed);
    const heavyAttack = this.key("KeyK") || this.rightMouse || Boolean(pad?.buttons?.[1]?.pressed);
    const sprint = this.key("ShiftLeft", "ShiftRight") || Boolean(pad?.buttons?.[7]?.pressed);
    const emote = this.key("KeyC") || Boolean(pad?.buttons?.[3]?.pressed);

    return {
      tick,
      moveX,
      moveZ,
      jump,
      grab,
      lightAttack,
      heavyAttack,
      sprint,
      emote,
    };
  }
}

// WobbleSimulator replaced by RagdollManager (see ragdoll.ts)

class SceneRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly composer: EffectComposer;
  private readonly toonGradientMap: THREE.DataTexture;

  private readonly arenaGroup = new THREE.Group();
  private readonly hazardGroup = new THREE.Group();
  private readonly playerGroup = new THREE.Group();

  private readonly playerVisuals = new Map<string, PlayerVisual>();

  // Camera shake state
  private shakeIntensity = 0;
  private shakeDecay = 8; // shake decays per second
  private readonly hazardVisuals = new Map<string, THREE.Mesh>();
  private readonly matteShadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.65, 20),
    new THREE.MeshBasicMaterial({ color: 0x04080f, transparent: true, opacity: 0.35 }),
  );

  private readonly particles: ParticleManager;
  private readonly characterLoader: CharacterLoader;
  private readonly beanMeshLoader: BeanMeshLoader;
  private readonly airborneState = new Map<string, boolean>();

  private activeArena: ArenaId | null = null;
  private elapsed = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ragdolls: RagdollManager,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Shadows
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Tone mapping
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a3048);
    this.scene.fog = new THREE.Fog(0x162a3c, 25, 58);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 140);
    this.camera.position.set(0, 14, 19);

    // Warm hemisphere light
    const hemi = new THREE.HemisphereLight(0xfff5e6, 0x1a3050, 1.15);
    // Key light with shadows
    const key = new THREE.DirectionalLight(0xfff0d6, 1.3);
    key.position.set(10, 16, 8);
    key.castShadow = true;
    key.shadow.mapSize.width = 1024;
    key.shadow.mapSize.height = 1024;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 50;
    key.shadow.camera.left = -20;
    key.shadow.camera.right = 20;
    key.shadow.camera.top = 20;
    key.shadow.camera.bottom = -20;
    // Rim light
    const rim = new THREE.DirectionalLight(0x77d0ff, 0.7);
    rim.position.set(-12, 9, -8);
    // Fill light
    const fill = new THREE.DirectionalLight(0xd4e8ff, 0.35);
    fill.position.set(-6, 4, 12);

    this.scene.add(hemi, key, rim, fill);
    this.scene.add(this.arenaGroup, this.hazardGroup, this.playerGroup);

    // Toon gradient map for cel-shading
    this.toonGradientMap = createToonGradientMap();

    // VFX particle system
    this.particles = new ParticleManager(this.scene);

    // Character loader (starts loading GLTF assets in background)
    this.characterLoader = new CharacterLoader();
    this.characterLoader.loadAll().catch((e) => console.warn("Character load failed, using fallback:", e));

    // Bean mesh loader (loads procedural bean character GLB if USE_BEAN_MESH is enabled)
    this.beanMeshLoader = new BeanMeshLoader();
    if (USE_BEAN_MESH) {
      this.beanMeshLoader.load().catch((e) => console.info("Bean mesh not available, using blob primitives:", e));
    }

    // Post-processing: bloom for glow effects
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.3,  // strength
      0.4,  // radius
      0.85, // threshold
    );
    this.composer.addPass(bloomPass);
    this.composer.addPass(new OutputPass());

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /** Trigger camera shake (intensity 0-1) */
  addCameraShake(intensity: number): void {
    this.shakeIntensity = Math.min(1, this.shakeIntensity + intensity);
  }

  /** Flash a player white for hit feedback */
  flashPlayer(id: string): void {
    const visual = this.playerVisuals.get(id);
    if (!visual) return;
    visual.flashTimer = 0.15;
  }

  /** Spawn hit VFX sparks at a player's torso. */
  spawnHitVFX(playerId: string, isHeavy: boolean): void {
    const pos = this.ragdolls.getBoneTransform(playerId, "torso");
    if (!pos) return;
    const count = isHeavy ? 15 : 8;
    this.particles.burst(pos, count, isHeavy ? 6 : 4, 0xfffae0, 0.35);
    if (isHeavy) {
      this.particles.burst(pos, 5, 3, 0xffaa33, 0.4);
    }
  }

  /** Spawn knockout VFX — big burst of red + yellow sparks. */
  spawnKnockoutVFX(playerId: string): void {
    const pos = this.ragdolls.getBoneTransform(playerId, "torso");
    if (!pos) return;
    this.particles.burst(pos, 25, 7, 0xff4444, 0.5);
    this.particles.burst(pos, 10, 5, 0xffdd44, 0.45);
  }

  /** Trigger an attack animation on a player's GLTF model. */
  triggerAttackAnim(playerId: string, type: "light" | "heavy"): void {
    const visual = this.playerVisuals.get(playerId);
    if (!visual?.mixer) return;
    const animState: GameAnimState = type === "heavy" ? "heavy_attack" : "light_attack";
    this.crossfadeAnim(visual, animState);
    visual.oneShotTimer = type === "heavy" ? 0.5 : 0.3;
  }

  triggerGrabAnim(playerId: string): void {
    const visual = this.playerVisuals.get(playerId);
    if (!visual?.mixer) return;
    this.crossfadeAnim(visual, "grab");
    visual.oneShotTimer = 0.6;
  }

  triggerThrowAnim(playerId: string): void {
    const visual = this.playerVisuals.get(playerId);
    if (!visual?.mixer) return;
    this.crossfadeAnim(visual, "throw");
    visual.oneShotTimer = 0.5;
  }

  /** Spawn grab VFX — blue particles at hand. */
  spawnGrabVFX(grabberId: string): void {
    const pos = this.ragdolls.getBoneTransform(grabberId, "r_lower_arm")
      ?? this.ragdolls.getBoneTransform(grabberId, "torso");
    if (!pos) return;
    this.particles.burst(pos, 6, 3, 0x44aaff, 0.3);
  }

  setArena(arena: ArenaId): void {
    if (this.activeArena === arena) return;

    this.activeArena = arena;
    this.clearGroup(this.arenaGroup);

    const floorGeo = new THREE.BoxGeometry(26, 0.6, 20);
    const edgeGeo = new THREE.BoxGeometry(26, 0.4, 1.2);

    const gm = this.toonGradientMap;

    if (arena === "cargo_rooftop") {
      const floor = new THREE.Mesh(
        floorGeo,
        new THREE.MeshToonMaterial({ color: 0x4f5f70, gradientMap: gm }),
      );
      floor.position.y = -0.3;
      floor.receiveShadow = true;
      this.arenaGroup.add(floor);

      for (let i = -2; i <= 2; i += 1) {
        const stripe = new THREE.Mesh(
          new THREE.BoxGeometry(2.1, 0.05, 18),
          new THREE.MeshToonMaterial({ color: 0xf2af3a, gradientMap: gm }),
        );
        stripe.position.set(i * 4.2, 0.05, 0);
        this.arenaGroup.add(stripe);
      }

      const brokenEdge = new THREE.Mesh(edgeGeo, new THREE.MeshToonMaterial({ color: 0x30353e, gradientMap: gm }));
      brokenEdge.position.set(0, 0.2, -9.7);
      this.arenaGroup.add(brokenEdge);
    }

    if (arena === "ferry_deck") {
      const floor = new THREE.Mesh(
        floorGeo,
        new THREE.MeshToonMaterial({ color: 0x1f6f8b, gradientMap: gm }),
      );
      floor.position.y = -0.3;
      floor.receiveShadow = true;
      this.arenaGroup.add(floor);

      for (let i = 0; i < 12; i += 1) {
        const lane = new THREE.Mesh(
          new THREE.BoxGeometry(1.3, 0.04, 0.35),
          new THREE.MeshToonMaterial({ color: 0xffcc4d, gradientMap: gm }),
        );
        lane.position.set(-7 + i * 1.3, 0.04, 0);
        this.arenaGroup.add(lane);
      }

      const wake = new THREE.Mesh(
        new THREE.TorusGeometry(9.5, 0.2, 16, 100),
        new THREE.MeshToonMaterial({ color: 0x6ce8ff, emissive: 0x1d8fab, emissiveIntensity: 0.3, gradientMap: gm }),
      );
      wake.rotation.x = Math.PI / 2;
      wake.position.y = -0.1;
      this.arenaGroup.add(wake);
    }

    if (arena === "factory_pit") {
      const floor = new THREE.Mesh(
        floorGeo,
        new THREE.MeshToonMaterial({ color: 0x2e2f34, gradientMap: gm }),
      );
      floor.position.y = -0.3;
      floor.receiveShadow = true;
      this.arenaGroup.add(floor);

      for (const z of [-2.2, 2.2]) {
        const conveyor = new THREE.Mesh(
          new THREE.BoxGeometry(18, 0.14, 2.8),
          new THREE.MeshToonMaterial({ color: 0x666f7c, gradientMap: gm }),
        );
        conveyor.position.set(0, 0.05, z);
        this.arenaGroup.add(conveyor);
      }

      for (const x of [-3.2, 3.2]) {
        const press = new THREE.Mesh(
          new THREE.CylinderGeometry(1, 1, 2.2, 28),
          new THREE.MeshToonMaterial({ color: 0x7b3131, gradientMap: gm }),
        );
        press.position.set(x, 1.4, 0);
        this.arenaGroup.add(press);
      }
    }
  }

  private clearGroup(group: THREE.Group): void {
    while (group.children.length > 0) {
      const child = group.children[0] as THREE.Mesh;
      group.remove(child);
      child.geometry?.dispose();
      if (Array.isArray(child.material)) {
        for (const m of child.material) m.dispose();
      } else {
        child.material?.dispose();
      }
    }
  }

  private ensurePlayerVisual(id: string): PlayerVisual {
    const existing = this.playerVisuals.get(id);
    if (existing) return existing;

    const hue = hashToHue(id);
    const color = new THREE.Color(`hsl(${hue}deg 82% 62%)`);
    const gm = this.toonGradientMap;

    // Resolve dimensions and visual style based on blob vs GLTF mode
    const isBlob = USE_BLOB_VISUALS;
    const TORSO_HALF_H = isBlob ? BLOB_TORSO_HALF_HEIGHT : RAGDOLL_TORSO_HALF_HEIGHT;
    const TORSO_R = isBlob ? BLOB_TORSO_RADIUS : RAGDOLL_TORSO_RADIUS;
    const HEAD_R = isBlob ? BLOB_HEAD_RADIUS : RAGDOLL_HEAD_RADIUS;
    const UPPER_ARM_HL = isBlob ? BLOB_UPPER_ARM_HALF_LENGTH : RAGDOLL_UPPER_ARM_HALF_LENGTH;
    const LOWER_ARM_HL = isBlob ? BLOB_LOWER_ARM_HALF_LENGTH : RAGDOLL_LOWER_ARM_HALF_LENGTH;
    const THIGH_HL = isBlob ? BLOB_THIGH_HALF_LENGTH : RAGDOLL_THIGH_HALF_LENGTH;
    const SHIN_HL = isBlob ? BLOB_SHIN_HALF_LENGTH : RAGDOLL_SHIN_HALF_LENGTH;
    const LIMB_R = isBlob ? BLOB_LIMB_RADIUS : RAGDOLL_LIMB_RADIUS;

    // Blob mode: chunkier scale, cartoony colors with emissive glow
    const VS = isBlob ? 1.6 : 1.4;
    const limbColor = isBlob
      ? color.clone().offsetHSL(0.02, 0, -0.10)
      : color.clone().offsetHSL(0.02, 0, -0.07);
    const headColor = isBlob
      ? color.clone().offsetHSL(0, 0, 0.22)
      : color.clone().offsetHSL(0, 0, 0.16);
    const legColor = isBlob
      ? limbColor.clone().offsetHSL(0, 0, -0.08)
      : limbColor.clone().offsetHSL(0, 0, -0.05);

    // Blob emissive glow for cartoony feel
    const blobEmissive = isBlob ? color.clone().multiplyScalar(0.15) : undefined;
    const blobEmissiveIntensity = isBlob ? 0.4 : 0;

    // Torso
    const torsoMat = new THREE.MeshToonMaterial({
      color,
      gradientMap: gm,
      ...(isBlob ? { emissive: blobEmissive, emissiveIntensity: blobEmissiveIntensity } : {}),
    });
    addFresnelRim(torsoMat);
    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(TORSO_R * VS, TORSO_HALF_H * 2 * VS, 7, 14),
      torsoMat,
    );
    torso.castShadow = true;
    torso.receiveShadow = true;

    // Head
    const headMat = new THREE.MeshToonMaterial({
      color: headColor,
      gradientMap: gm,
      ...(isBlob ? { emissive: headColor.clone().multiplyScalar(0.12), emissiveIntensity: 0.35 } : {}),
    });
    addFresnelRim(headMat);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(HEAD_R * VS, 16, 14),
      headMat,
    );
    head.castShadow = true;
    head.receiveShadow = true;

    // Arms (upper + lower)
    const makeArm = (halfLen: number, radius: number) => {
      const mat = new THREE.MeshToonMaterial({
        color: limbColor,
        gradientMap: gm,
        ...(isBlob ? { emissive: limbColor.clone().multiplyScalar(0.12), emissiveIntensity: 0.3 } : {}),
      });
      addFresnelRim(mat);
      const mesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(radius * VS, halfLen * 2 * VS, 4, 8),
        mat,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    };

    const leftArm = makeArm(UPPER_ARM_HL, LIMB_R);
    const rightArm = makeArm(UPPER_ARM_HL, LIMB_R);
    const leftForearm = makeArm(LOWER_ARM_HL, LIMB_R * 0.9);
    const rightForearm = makeArm(LOWER_ARM_HL, LIMB_R * 0.9);

    // Legs (thigh + shin)
    const makeLeg = (halfLen: number, radius: number) => {
      const mat = new THREE.MeshToonMaterial({
        color: legColor,
        gradientMap: gm,
        ...(isBlob ? { emissive: legColor.clone().multiplyScalar(0.10), emissiveIntensity: 0.25 } : {}),
      });
      addFresnelRim(mat);
      const mesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(radius * VS, halfLen * 2 * VS, 4, 8),
        mat,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    };

    const leftThigh = makeLeg(THIGH_HL, LIMB_R * 1.1);
    const rightThigh = makeLeg(THIGH_HL, LIMB_R * 1.1);
    const leftShin = makeLeg(SHIN_HL, LIMB_R * 0.85);
    const rightShin = makeLeg(SHIN_HL, LIMB_R * 0.85);

    // Emote indicator
    const emote = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.08, 0.03, 36, 7),
      new THREE.MeshToonMaterial({ color: 0xffd166, emissive: 0xff8a00, emissiveIntensity: 0.5, gradientMap: gm }),
    );
    emote.visible = false;

    // Shadow
    const shadow = this.matteShadow.clone();
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -0.42;

    const group = new THREE.Group();
    group.add(torso, head, leftArm, rightArm, leftForearm, rightForearm);
    group.add(leftThigh, rightThigh, leftShin, rightShin);
    group.add(emote, shadow);
    this.playerGroup.add(group);

    // Map bone names -> meshes for ragdoll-driven positioning
    const boneMeshes = new Map<BoneName, THREE.Mesh>();
    boneMeshes.set("torso", torso);
    boneMeshes.set("head", head);
    boneMeshes.set("l_upper_arm", leftArm);
    boneMeshes.set("r_upper_arm", rightArm);
    boneMeshes.set("l_lower_arm", leftForearm);
    boneMeshes.set("r_lower_arm", rightForearm);
    boneMeshes.set("l_thigh", leftThigh);
    boneMeshes.set("r_thigh", rightThigh);
    boneMeshes.set("l_shin", leftShin);
    boneMeshes.set("r_shin", rightShin);

    const originalEmissives = new Map<THREE.Mesh, THREE.Color>();
    for (const mesh of [torso, head, leftArm, rightArm, leftForearm, rightForearm, leftThigh, rightThigh, leftShin, rightShin]) {
      const mat = mesh.material as THREE.MeshToonMaterial;
      originalEmissives.set(mesh, mat.emissive.clone());
    }

    // Try to set up GLTF character model (skip when blob visuals are active)
    let gltfGroup: THREE.Group | null = null;
    let gltfBones: Map<BoneName, THREE.Bone> | null = null;
    let gltfMeshes: THREE.SkinnedMesh[] = [];
    let mixer: THREE.AnimationMixer | null = null;
    const animActions = new Map<string, THREE.AnimationAction>();

    if (!isBlob && this.characterLoader.isLoaded()) {
      const charName = this.characterLoader.pickCharacter(id);
      const charData = this.characterLoader.cloneCharacter(charName);

      if (charData) {
        gltfGroup = charData.group;
        gltfBones = new Map<BoneName, THREE.Bone>();
        gltfMeshes = charData.skinnedMeshes;

        // Build bone mapping: our BoneName -> GLTF Bone
        for (const [gameBone, kaykitName] of Object.entries(REVERSE_BONE_MAP)) {
          const bone = charData.bonesByName.get(kaykitName);
          if (bone) {
            gltfBones.set(gameBone as BoneName, bone);
          }
        }

        // Apply toon materials to GLTF meshes with player color tint
        const gm2 = this.toonGradientMap;
        for (const sm of gltfMeshes) {
          const oldMat = sm.material as THREE.MeshStandardMaterial;
          const toonMat = new THREE.MeshToonMaterial({
            map: oldMat.map,
            gradientMap: gm2,
            color: color.clone().lerp(new THREE.Color(0xffffff), 0.5),
          });
          addFresnelRim(toonMat);
          sm.material = toonMat;
          sm.castShadow = true;
          sm.receiveShadow = true;
          originalEmissives.set(sm as unknown as THREE.Mesh, toonMat.emissive.clone());
        }

        // Scale the model to match our ragdoll proportions
        // KayKit characters are ~1 unit tall; our ragdoll standing height is ~1.3 units
        gltfGroup.scale.setScalar(1.15);

        // Set up animation mixer
        mixer = new THREE.AnimationMixer(gltfGroup);
        const clips = this.characterLoader.getAnimationClips();
        for (const clip of clips) {
          const action = mixer.clipAction(clip);
          animActions.set(clip.name, action);
        }

        // Start with idle
        const idleAction = animActions.get(ANIM_MAP.idle);
        if (idleAction) {
          idleAction.play();
        }

        // Add GLTF group to the player group, hide fallback meshes
        group.add(gltfGroup);
        for (const mesh of boneMeshes.values()) {
          mesh.visible = false;
        }
      }
    }

    // Try to set up bean mesh (when USE_BEAN_MESH is enabled and GLB exists)
    let beanGroup: THREE.Group | null = null;
    let beanBones: Map<BoneName, THREE.Bone> | null = null;
    let beanMeshes: THREE.SkinnedMesh[] = [];

    if (USE_BEAN_MESH && !gltfGroup && this.beanMeshLoader.isLoaded()) {
      const beanData = this.beanMeshLoader.cloneBean();

      if (beanData) {
        beanGroup = beanData.group;
        beanBones = new Map<BoneName, THREE.Bone>();
        beanMeshes = beanData.skinnedMeshes;

        // Build bone mapping: our BoneName -> bean armature Bone
        for (const [gameBone, beanBoneName] of Object.entries(REVERSE_BEAN_BONE_MAP)) {
          const bone = beanData.bonesByName.get(beanBoneName);
          if (bone) {
            beanBones.set(gameBone as BoneName, bone);
          }
        }

        // Apply toon materials with player color tint
        const gm2 = this.toonGradientMap;
        for (const sm of beanMeshes) {
          const oldMat = sm.material as THREE.MeshStandardMaterial;
          const toonMat = new THREE.MeshToonMaterial({
            map: oldMat.map,
            gradientMap: gm2,
            color: color.clone(),
            emissive: color.clone().multiplyScalar(0.12),
            emissiveIntensity: 0.35,
          });
          addFresnelRim(toonMat);
          sm.material = toonMat;
          sm.castShadow = true;
          sm.receiveShadow = true;
          originalEmissives.set(sm as unknown as THREE.Mesh, toonMat.emissive.clone());
        }

        // Scale to match ragdoll proportions
        beanGroup.scale.setScalar(1.0);

        // Add bean group to player group, hide fallback blob meshes
        group.add(beanGroup);
        for (const mesh of boneMeshes.values()) {
          mesh.visible = false;
        }
      }
    }

    const visual: PlayerVisual = {
      group, torso, head, leftArm, rightArm, leftForearm, rightForearm,
      leftThigh, rightThigh, leftShin, rightShin, emote, color, boneMeshes,
      flashTimer: 0, originalEmissives,
      gltfGroup, gltfBones, gltfMeshes, mixer, currentAnim: gltfGroup ? "idle" : null, animActions,
      oneShotTimer: 0, displayYaw: NaN,
      beanGroup, beanBones, beanMeshes,
    };
    this.playerVisuals.set(id, visual);
    return visual;
  }

  private ensureHazardVisual(hazard: HazardStateNet): THREE.Mesh {
    const existing = this.hazardVisuals.get(hazard.id);
    if (existing) return existing;

    const gm = this.toonGradientMap;
    let geometry: THREE.BufferGeometry;
    let material: THREE.Material;

    if (hazard.kind === "moving_crate") {
      geometry = new THREE.BoxGeometry(1.7, 1.1, 1.1);
      material = new THREE.MeshToonMaterial({ color: 0xc17738, gradientMap: gm });
    } else if (hazard.kind === "sweeper") {
      geometry = new THREE.TorusGeometry(0.92, 0.24, 14, 36);
      material = new THREE.MeshToonMaterial({ color: 0xff5d73, gradientMap: gm });
    } else if (hazard.kind === "conveyor") {
      geometry = new THREE.BoxGeometry(3.1, 0.35, 1.8);
      material = new THREE.MeshToonMaterial({ color: 0x78828e, gradientMap: gm });
    } else {
      geometry = new THREE.CylinderGeometry(1.05, 1.05, 1.55, 20);
      material = new THREE.MeshToonMaterial({ color: 0xbc3f3f, gradientMap: gm });
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.hazardGroup.add(mesh);
    this.hazardVisuals.set(hazard.id, mesh);
    return mesh;
  }

  /** Determine which animation should play based on player state. */
  private resolveAnimState(player: PlayerStateNet, speed: number): GameAnimState {
    if (!player.alive) return "death";
    if (player.knockedOut) return "hit";
    if (player.stun >= 80) return "hit";
    if (player.emoteTimer > 0) return "emote";
    if (player.velocity.y > 3) return "jump_start";
    if (player.velocity.y < -2 && player.position.y > 0.5) return "jump_idle";
    if (speed > 5) return "run";
    if (speed > 0.8) return "walk";
    return "idle";
  }

  /** Crossfade from current animation to a new one. */
  private crossfadeAnim(visual: PlayerVisual, target: GameAnimState): void {
    if (!visual.mixer) return;
    const clipName = ANIM_MAP[target];
    const newAction = visual.animActions.get(clipName);
    if (!newAction) return;

    // Fade out current
    if (visual.currentAnim) {
      const oldClipName = ANIM_MAP[visual.currentAnim];
      const oldAction = visual.animActions.get(oldClipName);
      if (oldAction) {
        oldAction.fadeOut(0.2);
      }
    }

    // Fade in new
    newAction.reset().fadeIn(0.2).play();

    // One-shot animations (attacks, hit, death) should not loop
    if (target === "hit" || target === "death" || target === "light_attack" || target === "heavy_attack" || target === "grab" || target === "throw" || target === "jump_land") {
      newAction.setLoop(THREE.LoopOnce, 1);
      newAction.clampWhenFinished = true;
    } else {
      newAction.setLoop(THREE.LoopRepeat, Infinity);
    }

    visual.currentAnim = target;
  }

  renderFrame(params: {
    dt: number;
    nowSec: number;
    players: PlayerStateNet[];
    localPlayerId: string | null;
    hazards: HazardStateNet[];
    arena: ArenaId;
  }): void {
    this.elapsed += params.dt;

    this.setArena(params.arena);

    const activePlayerIds = new Set(params.players.map((p) => p.id));
    this.ragdolls.prune(activePlayerIds);

    for (const [id, visual] of this.playerVisuals) {
      if (activePlayerIds.has(id)) continue;
      visual.group.visible = false;
    }

    for (const player of params.players) {
      const visual = this.ensurePlayerVisual(player.id);
      visual.group.visible = player.alive || player.position.y > -6;

      // Drive the ragdoll physics to follow the capsule controller position
      const playerSpeed = Math.sqrt(player.velocity.x * player.velocity.x + player.velocity.z * player.velocity.z);
      const isSprinting = playerSpeed > 8.0;
      this.ragdolls.driveToPosition(
        player.id,
        player.position,
        player.velocity,
        player.facingYaw,
        player.stun,
        params.dt,
        isSprinting,
      );

      // Read ragdoll bone transforms and apply to visuals
      const bones = this.ragdolls.getAllBoneTransforms(player.id);

      if (visual.gltfGroup && visual.gltfBones && bones) {
        // ── GLTF mode: Animation-driven active ragdoll (Gang Beasts style) ──
        // 1. Position model at ragdoll torso for animation target computation
        // 2. Run animation mixer → bones get animation pose
        // 3. Read animation bone world positions → feed to ragdoll as PD targets
        // 4. Ragdoll physics drives bones toward animation targets
        // 5. Read ragdoll transforms → write to GLTF bones (ragdoll IS the visual)

        const torsoT = bones.get("torso");
        if (torsoT) {
          visual.group.position.set(0, 0, 0);
          visual.group.rotation.set(0, 0, 0);

          // Position GLTF group at ragdoll torso position
          visual.gltfGroup.position.set(torsoT.x, torsoT.y - 0.55, torsoT.z);
          if (isNaN(visual.displayYaw)) {
            visual.displayYaw = player.facingYaw;
          } else {
            visual.displayYaw = lerpAngle(visual.displayYaw, player.facingYaw, 0.15);
          }
          visual.gltfGroup.rotation.set(0, visual.displayYaw, 0);
        }

        // Detect landing for jump_land animation
        const wasAirborne = this.airborneState.get(player.id) ?? false;
        const isNowAirborne = player.velocity.y < -2 || player.position.y > 0.3;

        // Update animation mixer (this sets bone local transforms to animation pose)
        if (visual.mixer) {
          if (wasAirborne && !isNowAirborne && visual.oneShotTimer <= 0) {
            this.crossfadeAnim(visual, "jump_land");
            visual.oneShotTimer = 0.35;
          }

          if (visual.oneShotTimer > 0) {
            visual.oneShotTimer -= params.dt;
          } else {
            const targetAnim = this.resolveAnimState(player, playerSpeed);
            if (targetAnim !== visual.currentAnim) {
              this.crossfadeAnim(visual, targetAnim);
            }
          }
          visual.mixer.update(params.dt);
        }

        // Read animation bone world positions and local quaternions
        // (AFTER mixer update, BEFORE ragdoll overwrite)
        const animPositions = new Map<BoneName, { x: number; y: number; z: number }>();
        const animQuaternions = new Map<BoneName, { x: number; y: number; z: number; w: number }>();

        for (const [boneName, gltfBone] of visual.gltfBones) {
          // Update world matrix to get accurate world position
          gltfBone.updateWorldMatrix(true, false);
          _tmpVec3A.setFromMatrixPosition(gltfBone.matrixWorld);
          animPositions.set(boneName, { x: _tmpVec3A.x, y: _tmpVec3A.y, z: _tmpVec3A.z });

          // Read local quaternion (animation-driven rotation)
          animQuaternions.set(boneName, {
            x: gltfBone.quaternion.x,
            y: gltfBone.quaternion.y,
            z: gltfBone.quaternion.z,
            w: gltfBone.quaternion.w,
          });
        }

        // Feed animation targets to ragdoll PD system
        this.ragdolls.setAnimationTargets(player.id, animPositions, animQuaternions);

        // Now drive GLTF bones from ragdoll physics (ragdoll IS the visual)
        const ragdollInfluence = 1.0 - (this.ragdolls.getStiffness(player.id) ?? 1.0);
        // Always blend ragdoll into GLTF bones, but with varying strength
        // Normal gameplay: low influence (0.25) gives subtle physics feel
        // Hit/knockout: high influence (0.6-1.0) gives full ragdoll deformation
        const blendPosition = Math.max(0.15, ragdollInfluence * 0.6);
        const blendRotation = Math.max(0.1, ragdollInfluence * 0.5);

        for (const [boneName, transform] of bones) {
          const gltfBone = visual.gltfBones.get(boneName);
          if (!gltfBone || !gltfBone.parent) continue;

          gltfBone.parent.updateWorldMatrix(true, false);
          _tmpMat4.copy(gltfBone.parent.matrixWorld).invert();

          _tmpVec3A.set(transform.x, transform.y, transform.z);
          const localPos = _tmpVec3A.applyMatrix4(_tmpMat4);

          gltfBone.position.lerp(localPos, blendPosition);
          _tmpQuatA.set(transform.qx, transform.qy, transform.qz, transform.qw);
          gltfBone.parent.getWorldQuaternion(_tmpQuatB);
          _tmpQuatB.invert().multiply(_tmpQuatA);
          gltfBone.quaternion.slerp(_tmpQuatB, blendRotation);
        }

        // Position emote above head
        const headT = bones.get("head");
        if (headT) {
          visual.emote.position.set(headT.x, headT.y + 0.35, headT.z);
        }

        // Position shadow below torso
        if (torsoT) {
          const shadowChild = visual.group.children.find(
            (c) => c instanceof THREE.Mesh && c.geometry instanceof THREE.CircleGeometry,
          );
          if (shadowChild) {
            shadowChild.position.set(torsoT.x, 0.02, torsoT.z);
          }
        }
      } else if (visual.beanGroup && visual.beanBones && bones) {
        // ── Bean mesh mode: drive bean armature bones directly from ragdoll transforms ──
        // No animations — the ragdoll physics IS the animation.
        // Each ragdoll bone position/rotation drives the corresponding armature bone.

        const torsoT = bones.get("torso");
        if (torsoT) {
          visual.group.position.set(0, 0, 0);
          visual.group.rotation.set(0, 0, 0);

          // Position bean group at ragdoll torso position
          visual.beanGroup.position.set(torsoT.x, torsoT.y, torsoT.z);
          if (isNaN(visual.displayYaw)) {
            visual.displayYaw = player.facingYaw;
          } else {
            visual.displayYaw = lerpAngle(visual.displayYaw, player.facingYaw, 0.15);
          }
          visual.beanGroup.rotation.set(0, visual.displayYaw, 0);
        }

        // Drive bean armature bones from ragdoll physics
        for (const [boneName, transform] of bones) {
          const beanBone = visual.beanBones.get(boneName);
          if (!beanBone || !beanBone.parent) continue;

          // Convert ragdoll world transform to bone-local space
          beanBone.parent.updateWorldMatrix(true, false);
          _tmpMat4.copy(beanBone.parent.matrixWorld).invert();

          _tmpVec3A.set(transform.x, transform.y, transform.z);
          const localPos = _tmpVec3A.applyMatrix4(_tmpMat4);
          beanBone.position.copy(localPos);

          // Apply ragdoll rotation to bone
          _tmpQuatA.set(transform.qx, transform.qy, transform.qz, transform.qw);
          beanBone.parent.getWorldQuaternion(_tmpQuatB);
          _tmpQuatB.invert().multiply(_tmpQuatA);
          beanBone.quaternion.copy(_tmpQuatB);
        }

        // Position emote above head
        const headT = bones.get("head");
        if (headT) {
          visual.emote.position.set(headT.x, headT.y + 0.35, headT.z);
        }

        // Position shadow below torso
        if (torsoT) {
          const shadowChild = visual.group.children.find(
            (c) => c instanceof THREE.Mesh && c.geometry instanceof THREE.CircleGeometry,
          );
          if (shadowChild) {
            shadowChild.position.set(torsoT.x, 0.02, torsoT.z);
          }
        }
      } else if (bones) {
        // ── Fallback capsule mode ──
        visual.group.position.set(0, 0, 0);
        visual.group.rotation.set(0, 0, 0);

        for (const [boneName, transform] of bones) {
          const mesh = visual.boneMeshes.get(boneName);
          if (!mesh) continue;
          mesh.position.set(transform.x, transform.y, transform.z);
          mesh.quaternion.set(transform.qx, transform.qy, transform.qz, transform.qw);
        }

        const headTransform = bones.get("head");
        if (headTransform) {
          visual.emote.position.set(headTransform.x, headTransform.y + 0.35, headTransform.z);
        }

        const torsoTransform = bones.get("torso");
        if (torsoTransform) {
          const shadowChild = visual.group.children.find(
            (c) => c instanceof THREE.Mesh && c.geometry instanceof THREE.CircleGeometry,
          );
          if (shadowChild) {
            shadowChild.position.set(torsoTransform.x, 0.02, torsoTransform.z);
          }
        }
      } else {
        // Before ragdoll is created
        visual.group.position.set(player.position.x, player.position.y, player.position.z);
        if (isNaN(visual.displayYaw)) {
          visual.displayYaw = player.facingYaw;
        } else {
          visual.displayYaw = lerpAngle(visual.displayYaw, player.facingYaw, 0.15);
        }
        visual.group.rotation.y = visual.displayYaw;
      }

      visual.emote.visible = player.emoteTimer > 0;
      if (visual.emote.visible) {
        visual.emote.rotation.x += params.dt * 5;
        visual.emote.rotation.y += params.dt * 6;
      }

      // Local player highlight
      const skinnedMeshList = visual.gltfMeshes.length > 0 ? visual.gltfMeshes : visual.beanMeshes;
      if (skinnedMeshList.length > 0) {
        for (const sm of skinnedMeshList) {
          const mat = sm.material as THREE.MeshToonMaterial;
          if (player.id === params.localPlayerId) {
            mat.emissive.setHex(0x183f53);
            mat.emissiveIntensity = 0.35;
          } else {
            mat.emissive.setHex(0x000000);
            mat.emissiveIntensity = 0;
          }
        }
      } else {
        if (player.id === params.localPlayerId) {
          (visual.torso.material as THREE.MeshToonMaterial).emissive.setHex(0x183f53);
          (visual.torso.material as THREE.MeshToonMaterial).emissiveIntensity = 0.35;
        } else {
          (visual.torso.material as THREE.MeshToonMaterial).emissive.setHex(0x000000);
          (visual.torso.material as THREE.MeshToonMaterial).emissiveIntensity = 0;
        }
      }

      // Hit flash effect
      if (visual.flashTimer > 0) {
        visual.flashTimer -= params.dt;
        const flashIntensity = Math.max(0, visual.flashTimer / 0.15);
        for (const [mesh, origEmissive] of visual.originalEmissives) {
          const mat = mesh.material as THREE.MeshToonMaterial;
          mat.emissive.lerpColors(origEmissive, _hitFlashColor, flashIntensity);
          mat.emissiveIntensity = flashIntensity * 1.5;
        }
      } else {
        for (const [mesh, origEmissive] of visual.originalEmissives) {
          if (mesh === visual.torso && player.id === params.localPlayerId) continue;
          const mat = mesh.material as THREE.MeshToonMaterial;
          mat.emissive.copy(origEmissive);
          mat.emissiveIntensity = 0;
        }
      }
    }

    // Step ragdoll physics
    this.ragdolls.step(params.dt);

    const activeHazards = new Set(params.hazards.map((h) => h.id));
    for (const [id, mesh] of this.hazardVisuals) {
      if (activeHazards.has(id)) continue;
      mesh.visible = false;
    }

    for (const hazard of params.hazards) {
      const mesh = this.ensureHazardVisual(hazard);
      mesh.visible = hazard.active;
      mesh.position.set(hazard.position.x, hazard.position.y, hazard.position.z);

      if (hazard.kind === "sweeper") {
        mesh.rotation.y += params.dt * 5;
      }
      if (hazard.kind === "conveyor") {
        mesh.rotation.x += params.dt * 8;
      }
      if (hazard.kind === "press") {
        mesh.scale.y = hazard.active ? 0.9 : 1;
      }
    }

    // Landing dust detection
    for (const player of params.players) {
      const wasAirborne = this.airborneState.get(player.id) ?? false;
      const isAirborne = player.velocity.y < -2 || player.position.y > 0.3;
      this.airborneState.set(player.id, isAirborne);
      if (wasAirborne && !isAirborne) {
        // Just landed — spawn dust
        this.particles.burst(
          { x: player.position.x, y: 0.05, z: player.position.z },
          8, 2.5, 0xc4a66a, 0.35,
        );
      }
    }

    // Update particle system
    this.particles.update(params.dt);

    const local = params.localPlayerId ? params.players.find((p) => p.id === params.localPlayerId) : null;
    // Spectator camera: if local player is dead, follow the first alive player
    let cameraTarget = local;
    if (local && !local.alive) {
      cameraTarget = params.players.find((p) => p.alive) ?? local;
    }
    if (cameraTarget) {
      _tmpVec3A.set(cameraTarget.position.x, cameraTarget.position.y + 1.8, cameraTarget.position.z);
    } else {
      _tmpVec3A.set(0, 0, 0);
    }
    _tmpVec3B.set(_tmpVec3A.x, _tmpVec3A.y + 8, _tmpVec3A.z + 11);

    this.camera.position.lerp(_tmpVec3B, 0.11);
    this.camera.lookAt(_tmpVec3A.x, _tmpVec3A.y, _tmpVec3A.z);

    // Apply camera shake
    if (this.shakeIntensity > 0.01) {
      const shakeX = (Math.random() - 0.5) * this.shakeIntensity * 0.4;
      const shakeY = (Math.random() - 0.5) * this.shakeIntensity * 0.3;
      this.camera.position.x += shakeX;
      this.camera.position.y += shakeY;
      this.shakeIntensity = Math.max(0, this.shakeIntensity - this.shakeDecay * params.dt);
    }

    this.composer.render();
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return a + diff * t;
}

class RuckusGame {
  private readonly canvas = document.querySelector<HTMLCanvasElement>("#game-canvas")!;
  private readonly menuPanel = document.querySelector<HTMLElement>("#menu-panel")!;
  private readonly statusText = document.querySelector<HTMLElement>("#status-text")!;

  private readonly playerNameInput = document.querySelector<HTMLInputElement>("#player-name")!;
  private readonly roomCodeInput = document.querySelector<HTMLInputElement>("#room-code")!;

  private readonly createButton = document.querySelector<HTMLButtonElement>("#create-room-btn")!;
  private readonly joinButton = document.querySelector<HTMLButtonElement>("#join-room-btn")!;
  private readonly soloButton = document.querySelector<HTMLButtonElement>("#solo-btn")!;
  private readonly practiceButton = document.querySelector<HTMLButtonElement>("#practice-btn")!;
  private readonly readyButton = document.querySelector<HTMLButtonElement>("#ready-btn")!;
  private readonly rematchButton = document.querySelector<HTMLButtonElement>("#rematch-btn")!;
  private readonly fullscreenButton = document.querySelector<HTMLButtonElement>("#fullscreen-btn")!;

  private readonly hudRoom = document.querySelector<HTMLElement>("#hud-room")!;
  private readonly hudMode = document.querySelector<HTMLElement>("#hud-mode")!;
  private readonly hudRound = document.querySelector<HTMLElement>("#hud-round")!;
  private readonly hudTimer = document.querySelector<HTMLElement>("#hud-timer")!;
  private readonly hudArena = document.querySelector<HTMLElement>("#hud-arena")!;
  private readonly hudScore = document.querySelector<HTMLElement>("#hud-score")!;

  private readonly eventFeed = document.querySelector<HTMLElement>("#event-feed")!;

  private readonly roundEndOverlay = document.querySelector<HTMLElement>("#round-end-overlay")!;
  private readonly roundEndTitle = document.querySelector<HTMLElement>("#round-end-title")!;
  private readonly roundEndPlayers = document.querySelector<HTMLElement>("#round-end-players")!;
  private readonly roundEndSubtitle = document.querySelector<HTMLElement>("#round-end-subtitle")!;

  private readonly input: InputController;
  private readonly audio = new AudioBank();
  private readonly ragdolls = new RagdollManager();
  private readonly renderer: SceneRenderer;

  private client = new ColyseusClient(SERVER_URL);
  private room: Room | null = null;

  private localPlayerId: string | null = null;
  private localTick = 0;
  private localReady = false;

  private latestSnapshot: SnapshotNet | null = null;
  private latestRoundMode: MatchMode = "online";
  private latestRoomCode = "-";

  private interpolation = new Map<string, TimedState[]>();
  private pendingInputs: InputFrame[] = [];
  private predictedLocal: PlayerStateNet | null = null;

  private rafLastMs = performance.now();
  private simulationNowMs = performance.now();
  private inputAccumulator = 0;

  // Client-side cooldowns for triggering local attack/grab animations
  private localLightCooldown = 0;
  private localHeavyCooldown = 0;
  private localGrabCooldown = 0;

  /** Previous scoreboard (wins per player id) — used for score count-up animation */
  private previousWins = new Map<string, number>();

  private readonly loop = (ts: number) => {
    const dt = Math.min(0.05, (ts - this.rafLastMs) / 1000);
    this.rafLastMs = ts;
    this.simulationNowMs = ts;

    this.stepFixedAccumulated(dt);
    this.render(ts / 1000, dt);

    requestAnimationFrame(this.loop);
  };

  constructor() {
    this.canvas.tabIndex = 0;
    this.input = new InputController(this.canvas);
    this.renderer = new SceneRenderer(this.canvas, this.ragdolls);

    this.bindUI();
    this.installDebugHooks();
  }

  private setModeButtonsDisabled(disabled: boolean): void {
    this.createButton.disabled = disabled;
    this.joinButton.disabled = disabled;
    this.soloButton.disabled = disabled;
    this.practiceButton.disabled = disabled;
  }

  private focusGameplayCanvas(): void {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== this.canvas) {
      active.blur();
    }
    this.canvas.focus({ preventScroll: true });
  }

  private isGameplayKey(code: string): boolean {
    switch (code) {
      case "KeyW":
      case "KeyA":
      case "KeyS":
      case "KeyD":
      case "ArrowUp":
      case "ArrowDown":
      case "ArrowLeft":
      case "ArrowRight":
      case "Space":
      case "KeyE":
      case "KeyJ":
      case "KeyK":
      case "KeyC":
      case "ShiftLeft":
      case "ShiftRight":
      case "KeyF":
        return true;
      default:
        return false;
    }
  }

  async init(): Promise<void> {
    this.setStatus(`Status: Ready. Server ${SERVER_URL}`);
    requestAnimationFrame(this.loop);
  }

  private isRoomSendSafe(room: Room | null): room is Room {
    if (!room) return false;
    const connection = (room as Room & { connection?: unknown }).connection as
      | {
          isOpen?: boolean;
        }
      | undefined;

    // Colyseus transport shape differs across runtimes; trust `send` try/catch for final safety.
    return connection?.isOpen !== false;
  }

  private safeSend(type: string, payload: unknown): boolean {
    const room = this.room;
    if (!this.isRoomSendSafe(room)) return false;
    try {
      room.send(type as never, payload as never);
      return true;
    } catch {
      // Ignore transient teardown races while sockets are closing.
      return false;
    }
  }

  private bindUI(): void {
    const unlockAudio = () => this.audio.unlock();
    window.addEventListener("pointerdown", unlockAudio, { once: true });

    this.createButton.addEventListener("click", () => {
      this.connect({ mode: "online", join: false }).catch((error) => this.handleError(error));
    });

    this.joinButton.addEventListener("click", () => {
      this.connect({ mode: "online", join: true }).catch((error) => this.handleError(error));
    });

    this.soloButton.addEventListener("click", () => {
      this.connect({ mode: "solo", join: false }).catch((error) => this.handleError(error));
    });

    this.practiceButton.addEventListener("click", () => {
      this.connect({ mode: "practice", join: false }).catch((error) => this.handleError(error));
    });

    this.readyButton.addEventListener("click", () => {
      this.localReady = !this.localReady;
      this.safeSend("ready_state", { ready: this.localReady });
      this.readyButton.textContent = this.localReady ? "Ready: ON" : "Ready: OFF";
    });

    this.rematchButton.addEventListener("click", () => {
      this.safeSend("vote_rematch", { vote: true });
      this.rematchButton.textContent = "Rematch Voted";
    });

    this.fullscreenButton.addEventListener("click", () => {
      this.toggleFullscreen().catch((error) => this.handleError(error));
    });

    window.addEventListener("keydown", (event) => {
      if (event.code === "KeyF") {
        this.toggleFullscreen().catch((error) => this.handleError(error));
      }
    });

    const swallowGameplayKeys = (event: KeyboardEvent) => {
      if (!this.room) return;
      if (!this.isGameplayKey(event.code)) return;
      event.preventDefault();
      if (document.activeElement !== this.canvas) {
        this.focusGameplayCanvas();
      }
    };
    window.addEventListener("keydown", swallowGameplayKeys, { capture: true });
    window.addEventListener("keyup", swallowGameplayKeys, { capture: true });

    document.addEventListener("fullscreenchange", () => {
      this.renderer.resize();
    });
  }

  private async connect(params: { mode: MatchMode; join: boolean }): Promise<void> {
    if (!this.playerNameInput.value.trim()) {
      this.playerNameInput.value = "Player";
    }

    await this.disconnect();

    const payload = {
      playerName: this.playerNameInput.value.trim().slice(0, 18),
      mode: params.mode,
      roomCode: this.roomCodeInput.value.trim().toUpperCase(),
    };

    this.setStatus(params.join ? "Status: Joining room..." : "Status: Creating room...");

    if (params.join) {
      const code = payload.roomCode;
      if (!code) {
        throw new Error("Enter a room code before joining.");
      }

      const response = await fetch(`${SERVER_HTTP_URL}/rooms`);
      if (!response.ok) {
        throw new Error(`Failed to query room list (${response.status})`);
      }

      const payloadRooms = (await response.json()) as RoomListResponse;
      const target = payloadRooms.rooms.find((room) => String(room.metadata?.roomCode ?? "").toUpperCase() === code);
      if (!target) {
        throw new Error(`Room code ${code} was not found.`);
      }

      this.room = await this.client.joinById(target.roomId, payload);
    } else {
      this.room = await this.client.create(ROOM_NAME, payload);
    }

    const room = this.room;
    this.localTick = 0;
    this.localReady = params.mode !== "online";
    this.pendingInputs = [];
    this.predictedLocal = null;
    this.interpolation.clear();

    room.onMessage("room_info", (msg: RoomInfoMessage) => {
      this.latestRoomCode = msg.roomCode;
      this.latestRoundMode = msg.mode;
      this.localPlayerId = msg.playerId;
      this.hudRoom.textContent = `Room: ${msg.roomCode}`;
      this.hudMode.textContent = `Mode: ${MODE_LABELS[msg.mode]}`;
      this.roomCodeInput.value = msg.roomCode;
      this.setStatus(`Status: Connected to ${msg.roomCode}`);
    });

    room.onMessage("snapshot", (snapshot: SnapshotNet) => {
      this.onSnapshot(snapshot);
    });

    room.onMessage("round_event", (event: RoundEvent) => {
      this.onRoundEvent(event);
    });

    room.onMessage("sync_tick", (data: { serverTick: number }) => {
      this.localTick = data.serverTick;
    });

    room.onLeave(() => {
      this.setStatus("Status: Disconnected from room");
      this.room = null;
      this.setModeButtonsDisabled(false);
      this.menuPanel.classList.add("visible");
    });

    this.safeSend("join_room", payload);
    this.safeSend("ready_state", { ready: this.localReady });

    this.readyButton.textContent = this.localReady ? "Ready: ON" : "Ready: OFF";
    this.rematchButton.textContent = "Vote Rematch";

    this.setModeButtonsDisabled(true);
    this.menuPanel.classList.remove("visible");
    this.focusGameplayCanvas();
  }

  private async disconnect(): Promise<void> {
    const room = this.room;
    this.room = null;
    if (!room) return;
    try {
      if (this.isRoomSendSafe(room)) {
        await room.leave(true);
      }
    } catch {
      // Ignore disconnect races from closing browsers/test harnesses.
    }
    this.setModeButtonsDisabled(false);
    this.menuPanel.classList.add("visible");
  }

  private onSnapshot(snapshot: SnapshotNet): void {
    this.latestSnapshot = snapshot;
    this.latestRoundMode = snapshot.roundState.mode;
    this.localTick = Math.max(this.localTick, snapshot.serverTick);

    const now = performance.now();
    for (const player of snapshot.players) {
      let list = this.interpolation.get(player.id);
      if (!list) {
        list = [];
        this.interpolation.set(player.id, list);
      }
      list.push({
        atMs: now,
        state: {
          ...player,
          position: { ...player.position },
          velocity: { ...player.velocity },
        },
      });
      // Prune old entries in-place
      const cutoff = now - 1800;
      let pruneIdx = 0;
      while (pruneIdx < list.length && list[pruneIdx].atMs < cutoff) pruneIdx++;
      if (pruneIdx > 0) list.splice(0, pruneIdx);
    }

    if (this.localPlayerId) {
      const authoritative = snapshot.players.find((player) => player.id === this.localPlayerId);
      if (authoritative) {
        this.predictedLocal = {
          ...authoritative,
          position: { ...authoritative.position },
          velocity: { ...authoritative.velocity },
        };
        this.pendingInputs = this.pendingInputs.filter((input) => input.tick > authoritative.lastInputTick);

        for (const pending of this.pendingInputs) {
          integrateMotion(
            {
              position: this.predictedLocal.position,
              velocity: this.predictedLocal.velocity,
              facingYaw: this.predictedLocal.facingYaw,
            },
            pending,
            SERVER_TICK_DT,
            snapshot.roundState.arena,
          );
        }
      }
    }

    this.updateHud(snapshot);
  }

  private onRoundEvent(event: RoundEvent): void {
    let text = `[${event.type}]`;

    switch (event.type) {
      case "round_start":
        text = `Round started on ${ARENA_LABELS[(event.message as ArenaId) ?? "cargo_rooftop"]}`;
        this.audio.play("round");
        this.rematchButton.textContent = "Vote Rematch";
        this.hideRoundEndOverlay();
        break;
      case "round_end":
        text = `Round ended. Winner: ${this.resolvePlayerName(event.actorId)}`;
        this.showRoundEndOverlay(event.actorId);
        break;
      case "match_end":
        text = `Match winner: ${this.resolvePlayerName(event.actorId)}. Vote rematch to play again.`;
        this.rematchButton.textContent = "Vote Rematch";
        this.showRoundEndOverlay(event.actorId, true);
        break;
      case "hit": {
        const isHeavy = event.message === "heavy";
        this.audio.play(isHeavy ? "heavy" : "hit");
        text = `${this.resolvePlayerName(event.actorId)} ${isHeavy ? "heavy hit" : "hit"} ${this.resolvePlayerName(event.targetId)}`;
        // Camera shake — stronger for heavy attacks, only when local player involved
        if (event.targetId === this.localPlayerId || event.actorId === this.localPlayerId) {
          this.renderer.addCameraShake(isHeavy ? 0.4 : 0.15);
        } else {
          this.renderer.addCameraShake(isHeavy ? 0.08 : 0.03);
        }
        // Trigger attack pose on the attacker
        if (event.actorId) {
          this.ragdolls.triggerAttackPose(event.actorId, isHeavy ? "heavy" : "light");
          // Skip attack anim for local player — already triggered on input
          if (event.actorId !== this.localPlayerId) {
            this.renderer.triggerAttackAnim(event.actorId, isHeavy ? "heavy" : "light");
          }
        }
        // Flash the victim and spawn hit VFX
        if (event.targetId) {
          this.renderer.flashPlayer(event.targetId);
          this.renderer.spawnHitVFX(event.targetId, isHeavy);
        }
        // Apply ragdoll hit impulse with direction from attacker to target
        if (event.targetId && event.actorId) {
          const target = this.latestSnapshot?.players.find((p) => p.id === event.targetId);
          const actor = this.latestSnapshot?.players.find((p) => p.id === event.actorId);
          if (target && actor) {
            const dx = target.position.x - actor.position.x;
            const dz = target.position.z - actor.position.z;
            const dist = Math.max(0.1, Math.hypot(dx, dz));
            const magnitude = isHeavy ? 14 : 8;
            this.ragdolls.applyHitImpulse(
              event.targetId,
              { x: dx / dist, y: 0.5, z: dz / dist },
              magnitude,
              isHeavy,
            );
          }
        }
        break;
      }
      case "hazard_hit":
        this.audio.play("heavy");
        text = `${this.resolvePlayerName(event.targetId)} was slammed by a hazard`;
        if (event.targetId) {
          // Hazard hits are always heavy
          this.ragdolls.applyHitImpulse(event.targetId, { x: 0, y: 1, z: 0 }, 15, true);
        }
        // Camera shake for hazard hits
        this.renderer.addCameraShake(event.targetId === this.localPlayerId ? 0.5 : 0.1);
        break;
      case "knockout":
        this.audio.play("knockout");
        text = `${this.resolvePlayerName(event.targetId)} knocked out (${event.message ?? "impact"})`;
        if (event.targetId) {
          this.ragdolls.setKnockout(event.targetId);
          this.renderer.spawnKnockoutVFX(event.targetId);
        }
        // Big camera shake on knockout
        this.renderer.addCameraShake(event.targetId === this.localPlayerId ? 0.7 : 0.2);
        break;
      case "grab":
        this.audio.play("grab");
        text = `${this.resolvePlayerName(event.actorId)} grabbed ${this.resolvePlayerName(event.targetId)}`;
        // Create physics grab joint between grabber and target ragdolls
        if (event.actorId && event.targetId) {
          this.ragdolls.createGrabJoint(event.actorId, event.targetId);
          this.renderer.spawnGrabVFX(event.actorId);
          // Skip grab anim for local player — already triggered on input
          if (event.actorId !== this.localPlayerId) {
            this.renderer.triggerGrabAnim(event.actorId);
          }
        }
        break;
      case "release": {
        this.audio.play("throw");
        text = `${this.resolvePlayerName(event.actorId)} released ${this.resolvePlayerName(event.targetId)}`;
        // Release grab joint and apply throw impulse
        if (event.actorId && event.targetId) {
          const actor = this.latestSnapshot?.players.find((p) => p.id === event.actorId);
          const target = this.latestSnapshot?.players.find((p) => p.id === event.targetId);
          if (actor && target) {
            // Throw direction is from grabber toward target
            const dx = target.position.x - actor.position.x;
            const dz = target.position.z - actor.position.z;
            const dist = Math.max(0.1, Math.hypot(dx, dz));
            this.ragdolls.releaseGrabJoint(event.actorId, true, {
              x: dx / dist,
              y: 0.4,
              z: dz / dist,
            });
          } else {
            this.ragdolls.releaseGrabJoint(event.actorId, true);
          }
        }
        if (event.actorId) {
          this.renderer.triggerThrowAnim(event.actorId);
        }
        break;
      }
    }

    this.pushEvent(text);
  }

  private resolvePlayerName(id: string | undefined): string {
    if (!id) return "?";
    const player = this.latestSnapshot?.players.find((p) => p.id === id);
    return player?.name ?? id;
  }

  private showRoundEndOverlay(winnerId?: string, isMatchEnd = false): void {
    if (!this.latestSnapshot) return;

    this.roundEndTitle.textContent = isMatchEnd ? "Match Winner!" : "Round Over!";

    // Sort by wins descending, winner card first
    const players = [...this.latestSnapshot.players].sort((a, b) => {
      if (a.id === winnerId) return -1;
      if (b.id === winnerId) return 1;
      return b.wins - a.wins;
    });
    this.roundEndPlayers.innerHTML = "";

    let cardIndex = 0;
    for (const player of players) {
      const isWinner = player.id === winnerId;
      const card = document.createElement("div");
      card.className = "re-player" + (isWinner ? " winner" : "");

      // Staggered entrance delay
      const delay = isWinner ? 0 : 150 + cardIndex * 100;
      card.style.animationDelay = `${delay}ms`;

      // Crown on winner
      if (isWinner) {
        const crown = document.createElement("div");
        crown.className = "re-crown";
        crown.textContent = "\u{1F451}";
        card.appendChild(crown);
      }

      const hue = hashToHue(player.id);
      const avatar = document.createElement("div");
      avatar.className = "re-avatar";
      avatar.style.background = `hsl(${hue}deg 82% 62%)`;
      avatar.textContent = player.name.charAt(0).toUpperCase();

      const name = document.createElement("div");
      name.className = "re-name";
      name.textContent = player.name;

      const score = document.createElement("div");
      score.className = "re-score";

      // Score count-up animation for the winner
      const prevWins = this.previousWins.get(player.id) ?? 0;
      const newWins = player.wins;

      if (isWinner && newWins > prevWins) {
        score.textContent = String(prevWins);
        const countUpDelay = 400;
        const countUpDuration = 600;
        const steps = newWins - prevWins;
        const stepInterval = countUpDuration / steps;

        setTimeout(() => {
          let current = prevWins;
          const interval = setInterval(() => {
            current++;
            score.textContent = String(current);
            score.classList.remove("pop");
            // Force reflow to restart animation
            void score.offsetWidth;
            score.classList.add("pop");
            if (current >= newWins) {
              clearInterval(interval);
            }
          }, stepInterval);
        }, countUpDelay);
      } else {
        score.textContent = String(newWins);
      }

      card.appendChild(avatar);
      card.appendChild(name);
      card.appendChild(score);
      this.roundEndPlayers.appendChild(card);

      if (!isWinner) cardIndex++;
    }

    // Save current wins for next round's count-up
    for (const player of this.latestSnapshot.players) {
      this.previousWins.set(player.id, player.wins);
    }

    this.roundEndSubtitle.textContent = isMatchEnd
      ? "Vote rematch to play again!"
      : "Next round starting soon...";

    this.roundEndOverlay.classList.remove("hidden");
  }

  private hideRoundEndOverlay(): void {
    this.roundEndOverlay.classList.add("hidden");
  }

  private pushEvent(text: string): void {
    const line = document.createElement("div");
    line.className = "event";
    line.textContent = text;
    this.eventFeed.appendChild(line);

    while (this.eventFeed.children.length > 6) {
      this.eventFeed.removeChild(this.eventFeed.firstChild as ChildNode);
    }

    setTimeout(() => {
      if (line.parentElement === this.eventFeed) this.eventFeed.removeChild(line);
    }, 5000);
  }

  private setStatus(text: string): void {
    this.statusText.textContent = text;
  }

  private handleError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.setStatus(`Status: Error - ${message}`);
    this.pushEvent(`Error: ${message}`);
    // eslint-disable-next-line no-console
    console.error(error);
  }

  private updateHud(snapshot: SnapshotNet): void {
    const round = snapshot.roundState;
    this.hudRoom.textContent = `Room: ${this.latestRoomCode}`;
    this.hudMode.textContent = `Mode: ${MODE_LABELS[round.mode]}`;
    this.hudRound.textContent = `Round: ${round.roundNumber}/${round.maxRounds} (${round.phase})`;
    const localAlive = this.localPlayerId
      ? snapshot.players.find((p) => p.id === this.localPlayerId)?.alive ?? true
      : true;
    const spectating = round.phase === "active" && !localAlive;
    this.hudTimer.textContent = `Time: ${round.roundTimeLeft.toFixed(1)}s${round.suddenDeath ? " - Sudden Death" : ""}${spectating ? " - SPECTATING" : ""}`;
    this.hudArena.textContent = `Arena: ${ARENA_LABELS[round.arena]}`;

    const score = snapshot.players
      .slice()
      .sort((a, b) => b.wins - a.wins)
      .map((player) => `${player.name}:${player.wins}`)
      .join(" | ");
    this.hudScore.textContent = `Score: ${score || "-"}`;
  }

  private stepFixedAccumulated(dt: number): void {
    this.inputAccumulator += dt;

    while (this.inputAccumulator >= SERVER_TICK_DT) {
      this.fixedStep(SERVER_TICK_DT);
      this.inputAccumulator -= SERVER_TICK_DT;
    }
  }

  private fixedStep(dt: number): void {
    if (!this.room || !this.latestSnapshot || !this.localPlayerId) return;
    if (this.latestSnapshot.roundState.phase !== "active") return;

    // Dead/knocked-out player input suppression — no inputs sent when eliminated or KO'd
    const localPlayer = this.latestSnapshot.players.find((p) => p.id === this.localPlayerId);
    if (localPlayer && (!localPlayer.alive || localPlayer.knockedOut)) return;

    this.localTick = Math.max(this.localTick, this.latestSnapshot.serverTick) + 1;
    const input = this.input.sample(this.localTick);
    if (!this.safeSend("player_input", input)) return;
    this.pendingInputs.push(input);

    // Trigger local attack/grab animations on key press (independent of server hit confirmation)
    this.localLightCooldown = Math.max(0, this.localLightCooldown - dt);
    this.localHeavyCooldown = Math.max(0, this.localHeavyCooldown - dt);
    this.localGrabCooldown = Math.max(0, this.localGrabCooldown - dt);

    if (this.localPlayerId) {
      if (input.lightAttack && this.localLightCooldown <= 0) {
        this.renderer.triggerAttackAnim(this.localPlayerId, "light");
        this.localLightCooldown = 0.45;
      } else if (input.heavyAttack && this.localHeavyCooldown <= 0) {
        this.renderer.triggerAttackAnim(this.localPlayerId, "heavy");
        this.localHeavyCooldown = 0.95;
      } else if (input.grab && this.localGrabCooldown <= 0) {
        this.renderer.triggerGrabAnim(this.localPlayerId);
        this.localGrabCooldown = 0.6;
      }
    }

    if (this.pendingInputs.length > SERVER_TICK_RATE * 3) {
      this.pendingInputs.shift();
    }

    if (this.predictedLocal) {
      integrateMotion(
        {
          position: this.predictedLocal.position,
          velocity: this.predictedLocal.velocity,
          facingYaw: this.predictedLocal.facingYaw,
        },
        input,
        dt,
        this.latestSnapshot.roundState.arena,
      );

      this.predictedLocal.lastInputTick = input.tick;
    }
  }

  private resolveInterpolatedState(player: PlayerStateNet, renderTimeMs: number): PlayerStateNet {
    if (player.id === this.localPlayerId && this.predictedLocal && this.latestSnapshot?.roundState.phase === "active") {
      return this.predictedLocal;
    }

    const history = this.interpolation.get(player.id);
    if (!history || history.length < 2) {
      return player;
    }

    let older = history[0];
    let newer = history[history.length - 1];

    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (history[i].atMs <= renderTimeMs) {
        older = history[i];
        newer = history[Math.min(history.length - 1, i + 1)];
        break;
      }
    }

    const span = Math.max(1, newer.atMs - older.atMs);
    const t = clamp((renderTimeMs - older.atMs) / span, 0, 1);

    const lerp = (a: number, b: number) => a + (b - a) * t;

    return {
      ...newer.state,
      position: {
        x: lerp(older.state.position.x, newer.state.position.x),
        y: lerp(older.state.position.y, newer.state.position.y),
        z: lerp(older.state.position.z, newer.state.position.z),
      },
      velocity: {
        x: lerp(older.state.velocity.x, newer.state.velocity.x),
        y: lerp(older.state.velocity.y, newer.state.velocity.y),
        z: lerp(older.state.velocity.z, newer.state.velocity.z),
      },
      facingYaw: lerpAngle(older.state.facingYaw, newer.state.facingYaw, t),
    };
  }

  private render(nowSec: number, dt: number): void {
    if (!this.latestSnapshot) {
      this.renderer.renderFrame({
        dt,
        nowSec,
        players: [],
        localPlayerId: null,
        hazards: [],
        arena: "cargo_rooftop",
      });
      return;
    }

    const renderTimeMs = this.simulationNowMs - INTERPOLATION_DELAY_MS;
    const players = this.latestSnapshot.players.map((player) => this.resolveInterpolatedState(player, renderTimeMs));

    this.renderer.renderFrame({
      dt,
      nowSec,
      players,
      localPlayerId: this.localPlayerId,
      hazards: this.latestSnapshot.hazards,
      arena: this.latestSnapshot.roundState.arena,
    });
  }

  private buildRenderPayload(): RenderTextPayload {
    if (!this.latestSnapshot) {
      return {
        coordinateSystem: {
          origin: "Arena center (0,0,0)",
          xAxis: "+X is right",
          yAxis: "+Y is up",
          zAxis: "+Z is forward",
        },
        mode: this.latestRoundMode,
        roomCode: this.latestRoomCode,
        localPlayerId: this.localPlayerId,
        round: {
          phase: "lobby",
          mode: this.latestRoundMode,
          arena: "cargo_rooftop",
          roundNumber: 0,
          maxRounds: 5,
          roundTimeLeft: 0,
          suddenDeath: false,
          readyCount: 0,
          targetReadyCount: 0,
          survivors: [],
          scoreboard: {},
          roundWinnerId: null,
          matchWinnerId: null,
        },
        players: [],
        hazards: [],
      };
    }

    const renderTimeMs = this.simulationNowMs - INTERPOLATION_DELAY_MS;
    const players = this.latestSnapshot.players.map((player) => {
      const resolved = this.resolveInterpolatedState(player, renderTimeMs);
      return {
        id: resolved.id,
        name: resolved.name,
        alive: resolved.alive,
        role: resolved.role,
        position: { ...resolved.position },
        velocity: { ...resolved.velocity },
        stun: resolved.stun,
        wins: resolved.wins,
      };
    });

    return {
      coordinateSystem: {
        origin: "Arena center (0,0,0)",
        xAxis: "+X is right",
        yAxis: "+Y is up",
        zAxis: "+Z is forward",
      },
      mode: this.latestSnapshot.roundState.mode,
      roomCode: this.latestRoomCode,
      localPlayerId: this.localPlayerId,
      round: this.latestSnapshot.roundState,
      players,
      hazards: this.latestSnapshot.hazards,
    };
  }

  private installDebugHooks(): void {
    const api = {
      render_game_to_text: () => JSON.stringify(this.buildRenderPayload()),
      advanceTime: (ms: number) => {
        const steps = Math.max(1, Math.round(ms / (1000 / 60)));
        const dt = (ms / 1000) / steps;
        for (let i = 0; i < steps; i += 1) {
          this.fixedStep(dt);
          this.simulationNowMs += dt * 1000;
        }
        this.render(this.simulationNowMs / 1000, dt);
      },
    };

    Object.assign(window, api);
  }

  private async toggleFullscreen(): Promise<void> {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
    this.renderer.resize();
  }
}

async function bootstrap(): Promise<void> {
  await RAPIER.init();

  // Physics Lab mode: ?lab=1 in DEV builds only
  if (import.meta.env.DEV) {
    const params = new URLSearchParams(window.location.search);
    if (params.get("lab") === "1") {
      const { PhysicsLab } = await import("./physics-lab");
      const lab = new PhysicsLab();
      await lab.init();
      return;
    }
  }

  const game = new RuckusGame();
  await game.init();
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to boot game", error);
});
