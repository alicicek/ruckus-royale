import "./style.css";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { Client as ColyseusClient, Room } from "colyseus.js";
import { Howl, Howler } from "howler";
import {
  INTERPOLATION_DELAY_MS,
  ROOM_NAME,
  SERVER_TICK_DT,
  SERVER_TICK_RATE,
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

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:2567";
const SERVER_HTTP_URL = SERVER_URL.replace(/^ws/i, "http");

const ARENA_LABELS: Record<ArenaId, string> = {
  cargo_rooftop: "Cargo Rooftop",
  ferry_deck: "Ferry Deck",
  factory_pit: "Factory Pit",
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
  emote: THREE.Mesh;
  color: THREE.Color;
}

const hashToHue = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33 + value.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
};

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

  constructor() {
    Howler.volume(0.6);
  }

  unlock(): void {
    Howler.ctx?.resume().catch(() => undefined);
  }

  play(name: "hit" | "heavy" | "knockout" | "round"): void {
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

class WobbleSimulator {
  private readonly world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  private readonly bodies = new Map<string, RAPIER.RigidBody>();

  ensure(id: string): RAPIER.RigidBody {
    const existing = this.bodies.get(id);
    if (existing) return existing;

    const rb = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, 0, 0)
        .setLinearDamping(5)
        .setAngularDamping(6),
    );
    this.world.createCollider(RAPIER.ColliderDesc.ball(0.18).setRestitution(0.2), rb);
    this.bodies.set(id, rb);
    return rb;
  }

  drive(id: string, velocity: { x: number; y: number; z: number }, stun: number): void {
    const body = this.ensure(id);
    body.applyImpulse(
      {
        x: velocity.x * 0.03,
        y: velocity.y * 0.02 + stun * 0.0003,
        z: velocity.z * 0.03,
      },
      true,
    );
  }

  prune(activeIds: Set<string>): void {
    for (const [id, body] of this.bodies.entries()) {
      if (activeIds.has(id)) continue;
      this.world.removeRigidBody(body);
      this.bodies.delete(id);
    }
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();

    for (const body of this.bodies.values()) {
      const t = body.translation();
      body.setTranslation(
        {
          x: t.x * 0.9,
          y: t.y * 0.9,
          z: t.z * 0.9,
        },
        true,
      );
    }
  }

  sample(id: string): { x: number; y: number; z: number } {
    const body = this.bodies.get(id);
    if (!body) return { x: 0, y: 0, z: 0 };
    const t = body.translation();
    return { x: t.x, y: t.y, z: t.z };
  }
}

class SceneRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;

  private readonly arenaGroup = new THREE.Group();
  private readonly hazardGroup = new THREE.Group();
  private readonly playerGroup = new THREE.Group();

  private readonly playerVisuals = new Map<string, PlayerVisual>();
  private readonly hazardVisuals = new Map<string, THREE.Mesh>();
  private readonly matteShadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.65, 20),
    new THREE.MeshBasicMaterial({ color: 0x04080f, transparent: true, opacity: 0.35 }),
  );

  private activeArena: ArenaId | null = null;
  private elapsed = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly wobble: WobbleSimulator,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x13263b);
    this.scene.fog = new THREE.Fog(0x0f1b28, 25, 58);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 140);
    this.camera.position.set(0, 14, 19);

    const hemi = new THREE.HemisphereLight(0xe3f5ff, 0x102338, 1.15);
    const key = new THREE.DirectionalLight(0xffefd4, 1.2);
    key.position.set(10, 16, 8);
    const rim = new THREE.DirectionalLight(0x77d0ff, 0.7);
    rim.position.set(-12, 9, -8);

    this.scene.add(hemi, key, rim);
    this.scene.add(this.arenaGroup, this.hazardGroup, this.playerGroup);

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  setArena(arena: ArenaId): void {
    if (this.activeArena === arena) return;

    this.activeArena = arena;
    this.clearGroup(this.arenaGroup);

    const floorGeo = new THREE.BoxGeometry(26, 0.6, 20);
    const edgeGeo = new THREE.BoxGeometry(26, 0.4, 1.2);

    if (arena === "cargo_rooftop") {
      const floor = new THREE.Mesh(
        floorGeo,
        new THREE.MeshStandardMaterial({ color: 0x4f5f70, roughness: 0.82, metalness: 0.28 }),
      );
      floor.position.y = -0.3;
      this.arenaGroup.add(floor);

      for (let i = -2; i <= 2; i += 1) {
        const stripe = new THREE.Mesh(
          new THREE.BoxGeometry(2.1, 0.05, 18),
          new THREE.MeshStandardMaterial({ color: 0xf2af3a, roughness: 0.7 }),
        );
        stripe.position.set(i * 4.2, 0.05, 0);
        this.arenaGroup.add(stripe);
      }

      const brokenEdge = new THREE.Mesh(edgeGeo, new THREE.MeshStandardMaterial({ color: 0x30353e }));
      brokenEdge.position.set(0, 0.2, -9.7);
      this.arenaGroup.add(brokenEdge);
    }

    if (arena === "ferry_deck") {
      const floor = new THREE.Mesh(
        floorGeo,
        new THREE.MeshStandardMaterial({ color: 0x1f6f8b, roughness: 0.35, metalness: 0.25 }),
      );
      floor.position.y = -0.3;
      this.arenaGroup.add(floor);

      for (let i = 0; i < 12; i += 1) {
        const lane = new THREE.Mesh(
          new THREE.BoxGeometry(1.3, 0.04, 0.35),
          new THREE.MeshStandardMaterial({ color: 0xffcc4d, roughness: 0.6 }),
        );
        lane.position.set(-7 + i * 1.3, 0.04, 0);
        this.arenaGroup.add(lane);
      }

      const wake = new THREE.Mesh(
        new THREE.TorusGeometry(9.5, 0.2, 16, 100),
        new THREE.MeshStandardMaterial({ color: 0x6ce8ff, emissive: 0x1d8fab, emissiveIntensity: 0.3 }),
      );
      wake.rotation.x = Math.PI / 2;
      wake.position.y = -0.1;
      this.arenaGroup.add(wake);
    }

    if (arena === "factory_pit") {
      const floor = new THREE.Mesh(
        floorGeo,
        new THREE.MeshStandardMaterial({ color: 0x2e2f34, roughness: 0.9, metalness: 0.1 }),
      );
      floor.position.y = -0.3;
      this.arenaGroup.add(floor);

      for (const z of [-2.2, 2.2]) {
        const conveyor = new THREE.Mesh(
          new THREE.BoxGeometry(18, 0.14, 2.8),
          new THREE.MeshStandardMaterial({ color: 0x666f7c, roughness: 0.58, metalness: 0.34 }),
        );
        conveyor.position.set(0, 0.05, z);
        this.arenaGroup.add(conveyor);
      }

      for (const x of [-3.2, 3.2]) {
        const press = new THREE.Mesh(
          new THREE.CylinderGeometry(1, 1, 2.2, 28),
          new THREE.MeshStandardMaterial({ color: 0x7b3131, roughness: 0.65, metalness: 0.34 }),
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
    const color = new THREE.Color(`hsl(${hue}deg 74% 56%)`);

    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.43, 0.7, 7, 14),
      new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.08 }),
    );
    torso.castShadow = true;

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.31, 16, 14),
      new THREE.MeshStandardMaterial({ color: color.clone().offsetHSL(0, 0, 0.16), roughness: 0.42 }),
    );
    head.position.y = 0.95;

    const leftArm = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.12, 0.44, 4, 8),
      new THREE.MeshStandardMaterial({ color: color.clone().offsetHSL(0.02, 0, -0.07), roughness: 0.58 }),
    );
    leftArm.position.set(-0.48, 0.25, 0);
    leftArm.rotation.z = Math.PI / 12;

    const rightArm = leftArm.clone();
    rightArm.position.x = 0.48;
    rightArm.rotation.z = -Math.PI / 12;

    const emote = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.08, 0.03, 36, 7),
      new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0xff8a00, emissiveIntensity: 0.5 }),
    );
    emote.position.set(0, 1.35, 0);
    emote.visible = false;

    const shadow = this.matteShadow.clone();
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -0.42;

    const group = new THREE.Group();
    group.add(torso, head, leftArm, rightArm, emote, shadow);
    this.playerGroup.add(group);

    const visual: PlayerVisual = { group, torso, head, leftArm, rightArm, emote, color };
    this.playerVisuals.set(id, visual);
    return visual;
  }

  private ensureHazardVisual(hazard: HazardStateNet): THREE.Mesh {
    const existing = this.hazardVisuals.get(hazard.id);
    if (existing) return existing;

    let geometry: THREE.BufferGeometry;
    let material: THREE.Material;

    if (hazard.kind === "moving_crate") {
      geometry = new THREE.BoxGeometry(1.7, 1.1, 1.1);
      material = new THREE.MeshStandardMaterial({ color: 0xc17738, roughness: 0.65, metalness: 0.2 });
    } else if (hazard.kind === "sweeper") {
      geometry = new THREE.TorusGeometry(0.92, 0.24, 14, 36);
      material = new THREE.MeshStandardMaterial({ color: 0xff5d73, roughness: 0.44, metalness: 0.2 });
    } else if (hazard.kind === "conveyor") {
      geometry = new THREE.BoxGeometry(3.1, 0.35, 1.8);
      material = new THREE.MeshStandardMaterial({ color: 0x78828e, roughness: 0.58, metalness: 0.3 });
    } else {
      geometry = new THREE.CylinderGeometry(1.05, 1.05, 1.55, 20);
      material = new THREE.MeshStandardMaterial({ color: 0xbc3f3f, roughness: 0.55, metalness: 0.38 });
    }

    const mesh = new THREE.Mesh(geometry, material);
    this.hazardGroup.add(mesh);
    this.hazardVisuals.set(hazard.id, mesh);
    return mesh;
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
    this.wobble.prune(activePlayerIds);

    for (const [id, visual] of this.playerVisuals) {
      if (activePlayerIds.has(id)) continue;
      visual.group.visible = false;
    }

    for (const player of params.players) {
      const visual = this.ensurePlayerVisual(player.id);
      visual.group.visible = player.alive || player.position.y > -6;

      this.wobble.drive(player.id, player.velocity, player.stun);
      const wobble = this.wobble.sample(player.id);

      visual.group.position.set(player.position.x, player.position.y, player.position.z);
      visual.group.rotation.y = player.facingYaw;

      const pitch = clamp(player.velocity.z * 0.03 + wobble.x * 0.18, -0.5, 0.5);
      const roll = clamp(-player.velocity.x * 0.03 + wobble.z * 0.18, -0.5, 0.5);
      visual.torso.rotation.x = pitch;
      visual.torso.rotation.z = roll;

      const pulse = Math.sin(params.nowSec * 7 + hashToHue(player.id) * 0.09) * 0.06;
      visual.head.position.y = 0.95 + pulse + wobble.y * 0.4 + player.stun * 0.0018;

      const armSwing = Math.sin(params.nowSec * 9 + player.position.x * 0.3) * 0.38;
      visual.leftArm.rotation.x = armSwing;
      visual.rightArm.rotation.x = -armSwing;

      if (player.grabbedTargetId) {
        visual.leftArm.rotation.z = 0.3;
        visual.rightArm.rotation.z = -0.3;
      } else {
        visual.leftArm.rotation.z = Math.PI / 12;
        visual.rightArm.rotation.z = -Math.PI / 12;
      }

      visual.emote.visible = player.emoteTimer > 0;
      if (visual.emote.visible) {
        visual.emote.rotation.x += params.dt * 5;
        visual.emote.rotation.y += params.dt * 6;
      }

      if (player.id === params.localPlayerId) {
        (visual.torso.material as THREE.MeshStandardMaterial).emissive.setHex(0x183f53);
        (visual.torso.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.35;
      } else {
        (visual.torso.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
        (visual.torso.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
      }
    }

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

    const local = params.localPlayerId ? params.players.find((p) => p.id === params.localPlayerId) : null;
    const target = local ? new THREE.Vector3(local.position.x, local.position.y + 2.8, local.position.z) : new THREE.Vector3(0, 0, 0);
    const desiredCamera = target.clone().add(new THREE.Vector3(0, 12.5, 16.5));

    this.camera.position.lerp(desiredCamera, 0.11);
    this.camera.lookAt(target.x, target.y, target.z);

    this.wobble.step(params.dt);
    this.renderer.render(this.scene, this.camera);
  }
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

  private readonly input: InputController;
  private readonly audio = new AudioBank();
  private readonly wobble = new WobbleSimulator();
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

  private readonly loop = (ts: number) => {
    const dt = Math.min(0.05, (ts - this.rafLastMs) / 1000);
    this.rafLastMs = ts;
    this.simulationNowMs = ts;

    this.stepFixedAccumulated(dt);
    this.render(ts / 1000, dt);

    requestAnimationFrame(this.loop);
  };

  constructor() {
    this.input = new InputController(this.canvas);
    this.renderer = new SceneRenderer(this.canvas, this.wobble);

    this.bindUI();
    this.installDebugHooks();
  }

  async init(): Promise<void> {
    this.setStatus(`Status: Ready. Server ${SERVER_URL}`);
    requestAnimationFrame(this.loop);
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

    this.readyButton.addEventListener("click", () => {
      this.localReady = !this.localReady;
      this.room?.send("ready_state", { ready: this.localReady });
      this.readyButton.textContent = this.localReady ? "Ready: ON" : "Ready: OFF";
    });

    this.rematchButton.addEventListener("click", () => {
      this.room?.send("vote_rematch", { vote: true });
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
    this.localReady = params.mode === "solo";
    this.pendingInputs = [];
    this.predictedLocal = null;
    this.interpolation.clear();

    room.onMessage("room_info", (msg: RoomInfoMessage) => {
      this.latestRoomCode = msg.roomCode;
      this.latestRoundMode = msg.mode;
      this.localPlayerId = msg.playerId;
      this.hudRoom.textContent = `Room: ${msg.roomCode}`;
      this.hudMode.textContent = `Mode: ${msg.mode === "solo" ? "Solo" : "Online"}`;
      this.roomCodeInput.value = msg.roomCode;
      this.setStatus(`Status: Connected to ${msg.roomCode}`);
    });

    room.onMessage("snapshot", (snapshot: SnapshotNet) => {
      this.onSnapshot(snapshot);
    });

    room.onMessage("round_event", (event: RoundEvent) => {
      this.onRoundEvent(event);
    });

    room.onLeave(() => {
      this.setStatus("Status: Disconnected from room");
      this.room = null;
    });

    room.send("join_room", payload);
    room.send("ready_state", { ready: this.localReady });

    this.readyButton.textContent = this.localReady ? "Ready: ON" : "Ready: OFF";
    this.rematchButton.textContent = "Vote Rematch";

    this.menuPanel.classList.remove("visible");
  }

  private async disconnect(): Promise<void> {
    if (!this.room) return;
    await this.room.leave(true);
    this.room = null;
  }

  private onSnapshot(snapshot: SnapshotNet): void {
    this.latestSnapshot = snapshot;
    this.latestRoundMode = snapshot.roundState.mode;

    const now = performance.now();
    for (const player of snapshot.players) {
      const list = this.interpolation.get(player.id) ?? [];
      list.push({ atMs: now, state: structuredClone(player) });
      const pruned = list.filter((entry) => now - entry.atMs <= 1800);
      this.interpolation.set(player.id, pruned);
    }

    if (this.localPlayerId) {
      const authoritative = snapshot.players.find((player) => player.id === this.localPlayerId);
      if (authoritative) {
        this.predictedLocal = structuredClone(authoritative);
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
        break;
      case "round_end":
        text = `Round ended. Winner: ${event.actorId ?? "None"}`;
        break;
      case "match_end":
        text = `Match winner: ${event.actorId ?? "None"}. Vote rematch to play again.`;
        this.rematchButton.textContent = "Vote Rematch";
        break;
      case "hit":
        this.audio.play("hit");
        text = `${event.actorId ?? "?"} hit ${event.targetId ?? "?"}`;
        break;
      case "hazard_hit":
        this.audio.play("heavy");
        text = `${event.targetId ?? "?"} was slammed by a hazard`;
        break;
      case "knockout":
        this.audio.play("knockout");
        text = `${event.targetId ?? "?"} knocked out (${event.message ?? "impact"})`;
        break;
      case "grab":
        text = `${event.actorId ?? "?"} grabbed ${event.targetId ?? "?"}`;
        break;
      case "release":
        text = `${event.actorId ?? "?"} released ${event.targetId ?? "?"}`;
        break;
    }

    this.pushEvent(text);
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
    this.hudMode.textContent = `Mode: ${round.mode === "solo" ? "Solo" : "Online"}`;
    this.hudRound.textContent = `Round: ${round.roundNumber}/${round.maxRounds} (${round.phase})`;
    this.hudTimer.textContent = `Time: ${round.roundTimeLeft.toFixed(1)}s${round.suddenDeath ? " - Sudden Death" : ""}`;
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

    this.localTick += 1;
    const input = this.input.sample(this.localTick);
    this.room.send("player_input", input);
    this.pendingInputs.push(input);

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
      return structuredClone(this.predictedLocal);
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
      facingYaw: lerp(older.state.facingYaw, newer.state.facingYaw),
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

    const players = this.latestSnapshot.players.map((player) => ({
      id: player.id,
      name: player.name,
      alive: player.alive,
      role: player.role,
      position: { ...player.position },
      velocity: { ...player.velocity },
      stun: player.stun,
      wins: player.wins,
    }));

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
  const game = new RuckusGame();
  await game.init();
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to boot game", error);
});
