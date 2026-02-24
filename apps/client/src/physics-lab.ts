/**
 * Physics Lab — dev-only isolated scene for fast ragdoll physics iteration.
 *
 * Spawns a single puppet (via RagdollManager) on a test arena with slopes and
 * boxes.  No networking, no game rules.  Controlled entirely from keyboard
 * input (WASD + Space + Shift).
 *
 * Entry: `?lab=1` URL flag AND `import.meta.env.DEV`.
 */

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  COLLISION_GROUP_ENVIRONMENT,
  MOVE_SPEED,
  SPRINT_MULTIPLIER,
  JUMP_VELOCITY,
  GRAVITY,
  DRAG_GROUND,
  DRAG_AIR,
  MAX_FALL_SPEED,
  EXTRA_GRAVITY_FALLING,
  TURN_SPEED_RAD,
  PLAYER_RADIUS,
  RAGDOLL_TORSO_HALF_HEIGHT,
  RAGDOLL_TORSO_RADIUS,
  RAGDOLL_HEAD_RADIUS,
  RAGDOLL_UPPER_ARM_HALF_LENGTH,
  RAGDOLL_LOWER_ARM_HALF_LENGTH,
  RAGDOLL_THIGH_HALF_LENGTH,
  RAGDOLL_SHIN_HALF_LENGTH,
  RAGDOLL_LIMB_RADIUS,
  RAGDOLL_CONTACT_SKIN,
  QUAT_PD,
  clamp,
} from "@ruckus/shared";
import { RagdollManager, type BoneName } from "./ragdoll";
import { RapierDebugRenderer } from "./rapier-debug-renderer";

// ── Toon helpers (duplicated from main.ts to keep lab self-contained) ──

function createToonGradientMap(): THREE.DataTexture {
  const data = new Uint8Array([40, 120, 200, 255]);
  const texture = new THREE.DataTexture(data, 4, 1, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

function addFresnelRim(material: THREE.MeshToonMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <dithering_fragment>",
      `
      vec3 viewDir = normalize(vViewPosition);
      vec3 worldNormal = normalize(vNormal);
      float fresnel = pow(1.0 - abs(dot(viewDir, worldNormal)), 2.5);
      gl_FragColor.rgb += vec3(0.55, 0.72, 0.9) * fresnel * 0.45;
      #include <dithering_fragment>
      `,
    );
  };
}

// ── Collision group helper ──

function collisionGroup(membershipBit: number, filterMask: number): number {
  return ((membershipBit & 0xffff) << 16) | (filterMask & 0xffff);
}

// ── Local puppet state ──

interface PuppetState {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  facingYaw: number;
}

// ── PhysicsLab ──

export class PhysicsLab {
  // Three.js
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly composer: EffectComposer;
  private readonly toonGradientMap: THREE.DataTexture;

  // Physics
  private readonly ragdolls: RagdollManager;
  private readonly debugRenderer: RapierDebugRenderer;

  // Puppet
  private readonly PUPPET_ID = "__lab_puppet__";
  private puppet: PuppetState;

  // Visual meshes for the puppet bones
  private puppetGroup: THREE.Group;
  private boneMeshes = new Map<BoneName, THREE.Mesh>();

  // Input
  private readonly keysDown = new Set<string>();
  private leftMouse = false;
  private rightMouse = false;

  // Lab UI
  private slowMotion = false;
  private paused = false;
  private pendingSingleStep = false;

  // Timing
  private rafLastMs = performance.now();
  private fpsFrames = 0;
  private fpsTimer = 0;
  private lastPhysDt = 0;

  // DOM elements
  private readonly labPanel: HTMLElement;
  private readonly fpsDisplay: HTMLElement;
  private readonly dtDisplay: HTMLElement;
  private readonly pauseCheckbox: HTMLInputElement;
  private readonly debugRenderCheckbox: HTMLInputElement;
  private readonly stepBtn: HTMLButtonElement;

  constructor() {
    this.canvas = document.querySelector<HTMLCanvasElement>("#game-canvas")!;
    this.canvas.tabIndex = 0;

    // ── Renderer ──
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    // ── Scene ──
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a3048);
    this.scene.fog = new THREE.Fog(0x162a3c, 30, 65);

    // ── Camera ──
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 140);
    this.camera.position.set(0, 10, 14);

    // ── Lights ──
    const hemi = new THREE.HemisphereLight(0xfff5e6, 0x1a3050, 1.15);
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
    const rim = new THREE.DirectionalLight(0x77d0ff, 0.7);
    rim.position.set(-12, 9, -8);
    const fill = new THREE.DirectionalLight(0xd4e8ff, 0.35);
    fill.position.set(-6, 4, 12);
    this.scene.add(hemi, key, rim, fill);

    // ── Toon gradient ──
    this.toonGradientMap = createToonGradientMap();

    // ── Post-processing ──
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.3, 0.4, 0.85,
    );
    this.composer.addPass(bloomPass);
    this.composer.addPass(new OutputPass());

    // ── Ragdoll manager ──
    this.ragdolls = new RagdollManager();

    // ── Debug renderer ──
    this.debugRenderer = new RapierDebugRenderer(this.scene);

    // ── Puppet state ──
    this.puppet = {
      position: { x: 0, y: PLAYER_RADIUS, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      facingYaw: 0,
    };

    // Create puppet visual meshes
    this.puppetGroup = new THREE.Group();
    this.createPuppetVisuals();
    this.scene.add(this.puppetGroup);

    // ── Build test scene geometry ──
    this.buildTestScene();

    // ── Add test colliders to the ragdoll physics world ──
    this.addTestColliders();

    // ── Input listeners ──
    this.bindInput();

    // ── Lab UI ──
    this.labPanel = document.getElementById("lab-panel")!;
    this.fpsDisplay = document.getElementById("lab-fps")!;
    this.dtDisplay = document.getElementById("lab-dt")!;
    this.pauseCheckbox = document.getElementById("lab-pause") as HTMLInputElement;
    this.debugRenderCheckbox = document.getElementById("lab-debug-render") as HTMLInputElement;
    this.stepBtn = document.getElementById("lab-step-btn") as HTMLButtonElement;
    this.bindLabUI();

    // ── Resize ──
    this.resize();
    window.addEventListener("resize", () => this.resize());

    // Hide main game panels
    const menuPanel = document.getElementById("menu-panel");
    if (menuPanel) menuPanel.style.display = "none";
    const hudPanel = document.getElementById("hud-panel");
    if (hudPanel) hudPanel.style.display = "none";
  }

  // ── Public ──

  async init(): Promise<void> {
    // Show lab panel
    this.labPanel.style.display = "";

    // Ensure the puppet ragdoll is created
    this.ragdolls.ensure(this.PUPPET_ID);

    this.canvas.focus();
    requestAnimationFrame(this.loop);
  }

  // ── Game loop ──

  private readonly loop = (ts: number): void => {
    const rawDt = Math.min(0.1, (ts - this.rafLastMs) / 1000);
    this.rafLastMs = ts;

    // Timescale
    const timeScale = this.slowMotion ? 0.25 : 1.0;
    const dt = rawDt * timeScale;

    // FPS counting
    this.fpsFrames++;
    this.fpsTimer += rawDt;
    if (this.fpsTimer >= 0.5) {
      const fps = Math.round(this.fpsFrames / this.fpsTimer);
      this.fpsDisplay.textContent = String(fps);
      this.fpsFrames = 0;
      this.fpsTimer = 0;
    }

    // Physics step
    if (!this.paused || this.pendingSingleStep) {
      const stepDt = this.pendingSingleStep ? (1 / 60) * timeScale : dt;
      this.pendingSingleStep = false;

      this.stepPuppet(stepDt);
      this.ragdolls.step(stepDt);
      this.lastPhysDt = stepDt;
      this.dtDisplay.textContent = (stepDt * 1000).toFixed(2);
    }

    // Update visuals from ragdoll bone transforms
    this.syncVisuals();

    // Debug renderer (colliders + joints wireframe)
    this.debugRenderer.update(this.ragdolls.getWorld());

    // Camera follow
    this.updateCamera(rawDt);

    // Render
    this.composer.render();

    requestAnimationFrame(this.loop);
  };

  // ── Puppet movement (local simulation, no network) ──

  private stepPuppet(dt: number): void {
    const input = this.sampleInput();

    // Movement
    const speedMult = input.sprint ? SPRINT_MULTIPLIER : 1;
    const desired = this.normalize2(input.moveX, input.moveZ);
    const grounded = this.puppet.position.y <= PLAYER_RADIUS + 1e-3;

    const targetVX = desired.x * MOVE_SPEED * speedMult;
    const targetVZ = desired.z * MOVE_SPEED * speedMult;
    const drag = grounded ? DRAG_GROUND : DRAG_AIR;

    this.puppet.velocity.x += (targetVX - this.puppet.velocity.x) * clamp(drag * dt, 0, 1);
    this.puppet.velocity.z += (targetVZ - this.puppet.velocity.z) * clamp(drag * dt, 0, 1);

    if (grounded && input.jump) {
      this.puppet.velocity.y = JUMP_VELOCITY;
    }

    this.puppet.velocity.y += GRAVITY * dt;
    if (this.puppet.velocity.y < 0 && !grounded) {
      this.puppet.velocity.y += GRAVITY * (EXTRA_GRAVITY_FALLING - 1.0) * dt;
    }
    if (this.puppet.velocity.y < MAX_FALL_SPEED) {
      this.puppet.velocity.y = MAX_FALL_SPEED;
    }

    this.puppet.position.x += this.puppet.velocity.x * dt;
    this.puppet.position.y += this.puppet.velocity.y * dt;
    this.puppet.position.z += this.puppet.velocity.z * dt;

    // Floor collision at Y=0
    if (this.puppet.position.y <= PLAYER_RADIUS) {
      this.puppet.position.y = PLAYER_RADIUS;
      if (this.puppet.velocity.y < 0) this.puppet.velocity.y = 0;
    }

    // Prevent falling off the world (lab floor is large but bound it)
    this.puppet.position.x = clamp(this.puppet.position.x, -25, 25);
    this.puppet.position.z = clamp(this.puppet.position.z, -25, 25);

    // Facing yaw
    if (Math.abs(desired.x) > 0.2 || Math.abs(desired.z) > 0.2) {
      const targetYaw = Math.atan2(desired.x, desired.z);
      let diff = targetYaw - this.puppet.facingYaw;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      const maxTurn = TURN_SPEED_RAD * dt;
      this.puppet.facingYaw += Math.max(-maxTurn, Math.min(maxTurn, diff));
    }

    // Drive the ragdoll
    const speed = Math.sqrt(this.puppet.velocity.x ** 2 + this.puppet.velocity.z ** 2);
    const isSprinting = speed > 8.0;
    this.ragdolls.driveToPosition(
      this.PUPPET_ID,
      this.puppet.position,
      this.puppet.velocity,
      this.puppet.facingYaw,
      0, // no stun
      dt,
      isSprinting,
    );
  }

  // ── Visual puppet ──

  private createPuppetVisuals(): void {
    const gm = this.toonGradientMap;
    const color = new THREE.Color(0x4fc3f7); // bright blue
    const limbColor = color.clone().offsetHSL(0.02, 0, -0.07);
    const VS = 1.4; // visual scale

    const makeMesh = (geo: THREE.BufferGeometry, col: THREE.Color, boneName: BoneName): THREE.Mesh => {
      const mat = new THREE.MeshToonMaterial({ color: col, gradientMap: gm });
      addFresnelRim(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.boneMeshes.set(boneName, mesh);
      this.puppetGroup.add(mesh);
      return mesh;
    };

    // Torso
    makeMesh(
      new THREE.CapsuleGeometry(RAGDOLL_TORSO_RADIUS * VS, RAGDOLL_TORSO_HALF_HEIGHT * 2 * VS, 7, 14),
      color, "torso",
    );

    // Head
    makeMesh(
      new THREE.SphereGeometry(RAGDOLL_HEAD_RADIUS * VS, 16, 14),
      color.clone().offsetHSL(0, 0, 0.16), "head",
    );

    // Arms
    const makeArm = (halfLen: number, radius: number, bone: BoneName) => {
      makeMesh(new THREE.CapsuleGeometry(radius * VS, halfLen * 2 * VS, 4, 8), limbColor, bone);
    };
    makeArm(RAGDOLL_UPPER_ARM_HALF_LENGTH, RAGDOLL_LIMB_RADIUS, "l_upper_arm");
    makeArm(RAGDOLL_UPPER_ARM_HALF_LENGTH, RAGDOLL_LIMB_RADIUS, "r_upper_arm");
    makeArm(RAGDOLL_LOWER_ARM_HALF_LENGTH, RAGDOLL_LIMB_RADIUS * 0.9, "l_lower_arm");
    makeArm(RAGDOLL_LOWER_ARM_HALF_LENGTH, RAGDOLL_LIMB_RADIUS * 0.9, "r_lower_arm");

    // Legs
    const legColor = limbColor.clone().offsetHSL(0, 0, -0.05);
    const makeLeg = (halfLen: number, radius: number, bone: BoneName) => {
      makeMesh(new THREE.CapsuleGeometry(radius * VS, halfLen * 2 * VS, 4, 8), legColor, bone);
    };
    makeLeg(RAGDOLL_THIGH_HALF_LENGTH, RAGDOLL_LIMB_RADIUS * 1.1, "l_thigh");
    makeLeg(RAGDOLL_THIGH_HALF_LENGTH, RAGDOLL_LIMB_RADIUS * 1.1, "r_thigh");
    makeLeg(RAGDOLL_SHIN_HALF_LENGTH, RAGDOLL_LIMB_RADIUS * 0.85, "l_shin");
    makeLeg(RAGDOLL_SHIN_HALF_LENGTH, RAGDOLL_LIMB_RADIUS * 0.85, "r_shin");

    // Shadow blob under puppet
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.65, 20),
      new THREE.MeshBasicMaterial({ color: 0x04080f, transparent: true, opacity: 0.35 }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    shadow.name = "shadow";
    this.puppetGroup.add(shadow);
  }

  private syncVisuals(): void {
    const bones = this.ragdolls.getAllBoneTransforms(this.PUPPET_ID);
    if (!bones) return;

    for (const [boneName, transform] of bones) {
      const mesh = this.boneMeshes.get(boneName);
      if (!mesh) continue;
      mesh.position.set(transform.x, transform.y, transform.z);
      mesh.quaternion.set(transform.qx, transform.qy, transform.qz, transform.qw);
    }

    // Update shadow position
    const torso = bones.get("torso");
    if (torso) {
      const shadow = this.puppetGroup.getObjectByName("shadow");
      if (shadow) {
        shadow.position.set(torso.x, 0.02, torso.z);
      }
    }
  }

  // ── Test scene geometry (Three.js visuals) ──

  private buildTestScene(): void {
    const gm = this.toonGradientMap;

    // Floor plane (large flat box at Y=0)
    const floorMat = new THREE.MeshToonMaterial({ color: 0x4f5f70, gradientMap: gm });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(50, 0.5, 50), floorMat);
    floor.position.y = -0.25;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Grid lines on floor for spatial reference
    const gridHelper = new THREE.GridHelper(50, 50, 0x3a4a5a, 0x2a3a4a);
    gridHelper.position.y = 0.01;
    this.scene.add(gridHelper);

    // Slope / ramp (angled box)
    const slopeMat = new THREE.MeshToonMaterial({ color: 0xc17738, gradientMap: gm });
    addFresnelRim(slopeMat);
    const slope = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 3), slopeMat);
    slope.position.set(5, 0.8, -3);
    slope.rotation.z = -0.35; // angle it
    slope.rotation.y = 0.2;
    slope.castShadow = true;
    slope.receiveShadow = true;
    this.scene.add(slope);

    // Box 1: small
    const box1Mat = new THREE.MeshToonMaterial({ color: 0xff5d73, gradientMap: gm });
    addFresnelRim(box1Mat);
    const box1 = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), box1Mat);
    box1.position.set(-3, 0.5, 2);
    box1.castShadow = true;
    box1.receiveShadow = true;
    this.scene.add(box1);

    // Box 2: medium
    const box2Mat = new THREE.MeshToonMaterial({ color: 0x37c27f, gradientMap: gm });
    addFresnelRim(box2Mat);
    const box2 = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), box2Mat);
    box2.position.set(2, 0.75, 4);
    box2.castShadow = true;
    box2.receiveShadow = true;
    this.scene.add(box2);

    // Box 3: large
    const box3Mat = new THREE.MeshToonMaterial({ color: 0xffd166, gradientMap: gm });
    addFresnelRim(box3Mat);
    const box3 = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), box3Mat);
    box3.position.set(-5, 1, -4);
    box3.castShadow = true;
    box3.receiveShadow = true;
    this.scene.add(box3);
  }

  // ── Test colliders (Rapier physics in the ragdoll world) ──

  private addTestColliders(): void {
    const world = this.ragdolls.getWorld();
    const envGroup = collisionGroup(COLLISION_GROUP_ENVIRONMENT, 0xffff);

    // Note: The RagdollManager already creates a floor collider internally.
    // We add the slope and boxes as additional static colliders in the same world.

    // Slope / ramp collider — match the visual: 4x0.3x3 box at (5, 0.8, -3) rotated
    const slopeDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(5, 0.8, -3)
      .setRotation(this.eulerToQuat(0, 0.2, -0.35));
    const slopeBody = world.createRigidBody(slopeDesc);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(2, 0.15, 1.5)
        .setCollisionGroups(envGroup)
        .setFriction(0.5)
        .setRestitution(0.1),
      slopeBody,
    );

    // Box 1 collider: 1x1x1 at (-3, 0.5, 2)
    const box1Desc = RAPIER.RigidBodyDesc.fixed().setTranslation(-3, 0.5, 2);
    const box1Body = world.createRigidBody(box1Desc);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5)
        .setCollisionGroups(envGroup)
        .setFriction(0.5)
        .setRestitution(0.1),
      box1Body,
    );

    // Box 2 collider: 1.5x1.5x1.5 at (2, 0.75, 4)
    const box2Desc = RAPIER.RigidBodyDesc.fixed().setTranslation(2, 0.75, 4);
    const box2Body = world.createRigidBody(box2Desc);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.75, 0.75, 0.75)
        .setCollisionGroups(envGroup)
        .setFriction(0.5)
        .setRestitution(0.1),
      box2Body,
    );

    // Box 3 collider: 2x2x2 at (-5, 1, -4)
    const box3Desc = RAPIER.RigidBodyDesc.fixed().setTranslation(-5, 1, -4);
    const box3Body = world.createRigidBody(box3Desc);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(1, 1, 1)
        .setCollisionGroups(envGroup)
        .setFriction(0.5)
        .setRestitution(0.1),
      box3Body,
    );
  }

  // ── Camera ──

  private readonly _cameraTarget = new THREE.Vector3();
  private readonly _cameraDesired = new THREE.Vector3();

  private updateCamera(dt: number): void {
    const p = this.puppet.position;
    this._cameraTarget.set(p.x, p.y + 1.8, p.z);
    this._cameraDesired.set(p.x, p.y + 8, p.z + 11);

    this.camera.position.lerp(this._cameraDesired, Math.min(1, 4 * dt));
    this.camera.lookAt(this._cameraTarget);
  }

  // ── Input ──

  private toggleDebugRender(): void {
    const next = !this.debugRenderer.visible;
    this.debugRenderer.setVisible(next);
    this.debugRenderCheckbox.checked = next;
  }

  private bindInput(): void {
    window.addEventListener("keydown", (e) => {
      this.keysDown.add(e.code);

      // Backtick key toggles debug renderer
      if (e.code === "Backquote") {
        this.toggleDebugRender();
      }
    });
    window.addEventListener("keyup", (e) => {
      this.keysDown.delete(e.code);
    });
    window.addEventListener("blur", () => {
      this.keysDown.clear();
      this.leftMouse = false;
      this.rightMouse = false;
    });
    this.canvas.addEventListener("mousedown", (e) => {
      if (e.button === 0) this.leftMouse = true;
      if (e.button === 2) this.rightMouse = true;
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.leftMouse = false;
      if (e.button === 2) this.rightMouse = false;
    });
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private key(...codes: string[]): boolean {
    return codes.some((c) => this.keysDown.has(c));
  }

  private sampleInput(): {
    moveX: number;
    moveZ: number;
    jump: boolean;
    sprint: boolean;
  } {
    const pad = navigator.getGamepads?.()[0];
    const padX = pad?.axes?.[0] ?? 0;
    const padZ = pad?.axes?.[1] ?? 0;

    const kx = (this.key("KeyD", "ArrowRight") ? 1 : 0) - (this.key("KeyA", "ArrowLeft") ? 1 : 0);
    const kz = (this.key("KeyS", "ArrowDown") ? 1 : 0) - (this.key("KeyW", "ArrowUp") ? 1 : 0);

    const moveX = clamp(kx + (Math.abs(padX) > 0.18 ? padX : 0), -1, 1);
    const moveZ = clamp(kz + (Math.abs(padZ) > 0.18 ? padZ : 0), -1, 1);

    const jump = this.key("Space") || Boolean(pad?.buttons?.[0]?.pressed);
    const sprint = this.key("ShiftLeft", "ShiftRight") || Boolean(pad?.buttons?.[7]?.pressed);

    return { moveX, moveZ, jump, sprint };
  }

  // ── Lab UI binding ──

  private bindLabUI(): void {
    const slowCheck = document.getElementById("lab-slow-motion") as HTMLInputElement;
    slowCheck.addEventListener("change", () => {
      this.slowMotion = slowCheck.checked;
    });

    this.debugRenderCheckbox.addEventListener("change", () => {
      this.debugRenderer.setVisible(this.debugRenderCheckbox.checked);
    });

    this.pauseCheckbox.addEventListener("change", () => {
      this.paused = this.pauseCheckbox.checked;
      this.stepBtn.disabled = !this.paused;
    });

    this.stepBtn.addEventListener("click", () => {
      if (this.paused) {
        this.pendingSingleStep = true;
      }
    });

    // Contact Skin slider — updates all ragdoll colliders at runtime
    const contactSkinSlider = document.getElementById("lab-contact-skin") as HTMLInputElement;
    const contactSkinVal = document.getElementById("lab-contact-skin-val") as HTMLElement;
    contactSkinSlider.value = String(RAGDOLL_CONTACT_SKIN);
    contactSkinVal.textContent = String(RAGDOLL_CONTACT_SKIN);
    contactSkinSlider.addEventListener("input", () => {
      const val = parseFloat(contactSkinSlider.value);
      contactSkinVal.textContent = val.toFixed(3);
      // Update contact skin on all colliders in the ragdoll world
      const world = this.ragdolls.getWorld();
      world.forEachCollider((collider) => {
        collider.setContactSkin(val);
      });
    });

    // Physics quality dropdown (solver iterations)
    const qualitySelect = document.getElementById("lab-physics-quality") as HTMLSelectElement;
    // Apply initial value from the dropdown (Medium = 8)
    const qualityWorld = this.ragdolls.getWorld();
    qualityWorld.numSolverIterations = parseInt(qualitySelect.value, 10);
    qualitySelect.addEventListener("change", () => {
      const iters = parseInt(qualitySelect.value, 10);
      this.ragdolls.getWorld().numSolverIterations = iters;
    });

    // ── PD Tuning sliders (quaternion PD for spherical joints) ──
    const pdSliders: Array<{
      joint: "neck" | "shoulder" | "hip";
      param: "kp" | "kd" | "maxTorque";
      sliderId: string;
      valId: string;
    }> = [
      { joint: "neck",     param: "kp",        sliderId: "lab-pd-neck-kp",      valId: "lab-pd-neck-kp-val" },
      { joint: "neck",     param: "kd",        sliderId: "lab-pd-neck-kd",      valId: "lab-pd-neck-kd-val" },
      { joint: "neck",     param: "maxTorque", sliderId: "lab-pd-neck-max",     valId: "lab-pd-neck-max-val" },
      { joint: "shoulder", param: "kp",        sliderId: "lab-pd-shoulder-kp",  valId: "lab-pd-shoulder-kp-val" },
      { joint: "shoulder", param: "kd",        sliderId: "lab-pd-shoulder-kd",  valId: "lab-pd-shoulder-kd-val" },
      { joint: "shoulder", param: "maxTorque", sliderId: "lab-pd-shoulder-max", valId: "lab-pd-shoulder-max-val" },
      { joint: "hip",      param: "kp",        sliderId: "lab-pd-hip-kp",      valId: "lab-pd-hip-kp-val" },
      { joint: "hip",      param: "kd",        sliderId: "lab-pd-hip-kd",      valId: "lab-pd-hip-kd-val" },
      { joint: "hip",      param: "maxTorque", sliderId: "lab-pd-hip-max",     valId: "lab-pd-hip-max-val" },
    ];

    for (const { joint, param, sliderId, valId } of pdSliders) {
      const slider = document.getElementById(sliderId) as HTMLInputElement | null;
      const valSpan = document.getElementById(valId) as HTMLElement | null;
      if (!slider || !valSpan) continue;

      // Set initial value from QUAT_PD
      slider.value = String(QUAT_PD[joint][param]);
      valSpan.textContent = Number(QUAT_PD[joint][param]).toFixed(2);

      slider.addEventListener("input", () => {
        const v = parseFloat(slider.value);
        valSpan.textContent = v.toFixed(2);
        // QUAT_PD is a mutable object — update it directly for real-time tuning
        (QUAT_PD[joint] as Record<string, number>)[param] = v;
      });
    }

    const resetBtn = document.getElementById("lab-reset-btn") as HTMLButtonElement;
    resetBtn.addEventListener("click", () => {
      this.resetPuppet();
    });
  }

  private resetPuppet(): void {
    this.puppet.position = { x: 0, y: PLAYER_RADIUS, z: 0 };
    this.puppet.velocity = { x: 0, y: 0, z: 0 };
    this.puppet.facingYaw = 0;

    // Force ragdoll teleport by driving to the reset position
    this.ragdolls.driveToPosition(
      this.PUPPET_ID,
      { x: 100, y: 100, z: 100 }, // first move far away to trigger teleport check
      { x: 0, y: 0, z: 0 },
      0, 0, 1/60, false,
    );
    this.ragdolls.driveToPosition(
      this.PUPPET_ID,
      this.puppet.position,
      this.puppet.velocity,
      this.puppet.facingYaw,
      0, 1/60, false,
    );
  }

  // ── Resize ──

  private resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  // ── Math helpers ──

  private normalize2(x: number, z: number): { x: number; z: number } {
    const len = Math.hypot(x, z);
    if (len < 1e-6) return { x: 0, z: 0 };
    return { x: x / len, z: z / len };
  }

  /** Convert Euler angles (in radians) to a quaternion (YXZ order). */
  private eulerToQuat(x: number, y: number, z: number): { x: number; y: number; z: number; w: number } {
    const cx = Math.cos(x * 0.5), sx = Math.sin(x * 0.5);
    const cy = Math.cos(y * 0.5), sy = Math.sin(y * 0.5);
    const cz = Math.cos(z * 0.5), sz = Math.sin(z * 0.5);
    return {
      x: sx * cy * cz + cx * sy * sz,
      y: cx * sy * cz - sx * cy * sz,
      z: cx * cy * sz - sx * sy * cz,
      w: cx * cy * cz + sx * sy * sz,
    };
  }
}
