/**
 * Character and animation loader for KayKit GLTF assets.
 *
 * Loads character models (SkinnedMesh + Skeleton) and animation clips,
 * caches them, and provides cloning for per-player instances.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { BoneName } from "./ragdoll";

// ── Character roster ──

export const CHARACTER_NAMES = [
  "Barbarian",
  "Knight",
  "Mage",
  "Ranger",
  "Rogue",
  "Rogue_Hooded",
] as const;

export type CharacterName = (typeof CHARACTER_NAMES)[number];

// ── Animation bundles to load (only the ones we need for brawler) ──

const ANIMATION_BUNDLES = [
  "Rig_Medium_General",
  "Rig_Medium_MovementBasic",
  "Rig_Medium_CombatMelee",
  "Rig_Medium_Simulation",
] as const;

// ── Bone mapping: KayKit skeleton → our BoneName ──

export const BONE_MAP: Record<string, BoneName> = {
  chest: "torso",
  head: "head",
  "upperarm.l": "l_upper_arm",
  "upperarm.r": "r_upper_arm",
  "lowerarm.l": "l_lower_arm",
  "lowerarm.r": "r_lower_arm",
  "upperleg.l": "l_thigh",
  "upperleg.r": "r_thigh",
  "lowerleg.l": "l_shin",
  "lowerleg.r": "r_shin",
};

// Reverse mapping: our BoneName → KayKit bone name
export const REVERSE_BONE_MAP: Record<BoneName, string> = {} as Record<BoneName, string>;
for (const [kaykit, game] of Object.entries(BONE_MAP)) {
  REVERSE_BONE_MAP[game] = kaykit;
}

// ── Animation name mapping: game state → clip name ──

export const ANIM_MAP = {
  idle: "Idle_A",
  walk: "Walking_A",
  run: "Running_A",
  jump_start: "Jump_Start",
  jump_idle: "Jump_Idle",
  jump_land: "Jump_Land",
  light_attack: "Melee_Unarmed_Attack_Punch_A",
  heavy_attack: "Melee_Unarmed_Attack_Kick",
  hit: "Hit_A",
  death: "Death_A",
  grab: "Interact",
  throw: "Throw",
  emote: "Cheering",
  dodge_forward: "Dodge_Forward",
  dodge_backward: "Dodge_Backward",
  block: "Melee_Block",
  spawn: "Spawn_Ground",
} as const;

export type GameAnimState = keyof typeof ANIM_MAP;

// ── Bean character bone mapping: bean armature bone → our BoneName ──
// The bean armature uses the exact same names as our ragdoll BoneNames,
// so the mapping is direct (identity for most bones).

export const BEAN_BONE_MAP: Record<string, BoneName> = {
  torso: "torso",
  head: "head",
  l_upperArm: "l_upper_arm",
  r_upperArm: "r_upper_arm",
  l_foreArm: "l_lower_arm",
  r_foreArm: "r_lower_arm",
  l_thigh: "l_thigh",
  r_thigh: "r_thigh",
  l_shin: "l_shin",
  r_shin: "r_shin",
};

// Reverse mapping: our BoneName → bean armature bone name
export const REVERSE_BEAN_BONE_MAP: Record<BoneName, string> = {} as Record<BoneName, string>;
for (const [beanBone, gameBone] of Object.entries(BEAN_BONE_MAP)) {
  REVERSE_BEAN_BONE_MAP[gameBone] = beanBone;
}

// ── Cached data ──

interface CachedCharacter {
  scene: THREE.Group;
  skeleton: THREE.Skeleton;
  skinnedMeshes: THREE.SkinnedMesh[];
}

// ── CharacterLoader ──

export class CharacterLoader {
  private readonly loader = new GLTFLoader();
  private readonly characterCache = new Map<CharacterName, CachedCharacter>();
  private readonly animationClips: THREE.AnimationClip[] = [];
  private loaded = false;
  private loadingPromise: Promise<void> | null = null;

  /** Load all characters and animation bundles. Call once at startup. */
  async loadAll(): Promise<void> {
    if (this.loaded) return;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = this._loadAll();
    await this.loadingPromise;
    this.loaded = true;
  }

  private async _loadAll(): Promise<void> {
    // Load all characters in parallel
    const charPromises = CHARACTER_NAMES.map(async (name) => {
      try {
        const gltf = await this.loader.loadAsync(`/models/characters/${name}.glb`);
        const skinnedMeshes: THREE.SkinnedMesh[] = [];
        let skeleton: THREE.Skeleton | null = null;

        gltf.scene.traverse((child) => {
          if (child instanceof THREE.SkinnedMesh) {
            skinnedMeshes.push(child);
            if (!skeleton) skeleton = child.skeleton;
          }
        });

        if (skeleton && skinnedMeshes.length > 0) {
          this.characterCache.set(name, {
            scene: gltf.scene,
            skeleton,
            skinnedMeshes,
          });
        }
      } catch (e) {
        console.warn(`Failed to load character ${name}:`, e);
      }
    });

    // Load all animation bundles in parallel
    const animPromises = ANIMATION_BUNDLES.map(async (bundle) => {
      try {
        const gltf = await this.loader.loadAsync(`/models/animations/${bundle}.glb`);
        for (const clip of gltf.animations) {
          this.animationClips.push(clip);
        }
      } catch (e) {
        console.warn(`Failed to load animation bundle ${bundle}:`, e);
      }
    });

    await Promise.all([...charPromises, ...animPromises]);
  }

  /** Check if assets have loaded. */
  isLoaded(): boolean {
    return this.loaded;
  }

  /** Get available character names that loaded successfully. */
  getAvailableCharacters(): CharacterName[] {
    return CHARACTER_NAMES.filter((n) => this.characterCache.has(n));
  }

  /** Get all loaded animation clips. */
  getAnimationClips(): THREE.AnimationClip[] {
    return this.animationClips;
  }

  /** Get a specific animation clip by name. */
  getClip(name: string): THREE.AnimationClip | undefined {
    return this.animationClips.find((c) => c.name === name);
  }

  /**
   * Clone a character for a player instance. Returns a new Group with
   * cloned SkinnedMeshes that share geometry but have independent skeletons.
   */
  cloneCharacter(name: CharacterName): {
    group: THREE.Group;
    skinnedMeshes: THREE.SkinnedMesh[];
    skeleton: THREE.Skeleton;
    bonesByName: Map<string, THREE.Bone>;
  } | null {
    const cached = this.characterCache.get(name);
    if (!cached) return null;

    // Clone the scene — SkeletonUtils.clone handles SkinnedMesh properly
    const group = cloneSkinnedGroup(cached.scene);

    const skinnedMeshes: THREE.SkinnedMesh[] = [];
    const skeletonRef: { value: THREE.Skeleton | null } = { value: null };

    group.traverse((child) => {
      if (child instanceof THREE.SkinnedMesh) {
        skinnedMeshes.push(child);
        if (!skeletonRef.value) skeletonRef.value = child.skeleton;
      }
    });

    const skeleton = skeletonRef.value;
    if (!skeleton) return null;

    // Build bone lookup by name
    const bonesByName = new Map<string, THREE.Bone>();
    for (const bone of skeleton.bones) {
      bonesByName.set(bone.name, bone);
    }

    return { group, skinnedMeshes, skeleton, bonesByName };
  }

  /**
   * Pick a character for a player based on their ID (deterministic hash).
   */
  pickCharacter(playerId: string): CharacterName {
    const available = this.getAvailableCharacters();
    if (available.length === 0) return "Knight";
    let hash = 0;
    for (let i = 0; i < playerId.length; i++) {
      hash = (hash * 31 + playerId.charCodeAt(i)) >>> 0;
    }
    return available[hash % available.length];
  }
}

// ── Bean Mesh Loader ──

/**
 * Loader for the procedural bean character GLB.
 * Attempts to load the bean_character.glb generated by the Blender script.
 * If loading fails (file doesn't exist yet), it gracefully falls back.
 */
export class BeanMeshLoader {
  private readonly loader = new GLTFLoader();
  private cachedScene: THREE.Group | null = null;
  private cachedSkeleton: THREE.Skeleton | null = null;
  private cachedSkinnedMeshes: THREE.SkinnedMesh[] = [];
  private loaded = false;
  private failed = false;
  private loadingPromise: Promise<void> | null = null;

  /** Attempt to load the bean character GLB. Silently fails if file doesn't exist. */
  async load(): Promise<void> {
    if (this.loaded || this.failed) return;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = this._load();
    await this.loadingPromise;
  }

  private async _load(): Promise<void> {
    try {
      const gltf = await this.loader.loadAsync("/models/bean_character.glb");
      const skinnedMeshes: THREE.SkinnedMesh[] = [];
      let skeleton: THREE.Skeleton | null = null;

      gltf.scene.traverse((child) => {
        if (child instanceof THREE.SkinnedMesh) {
          skinnedMeshes.push(child);
          if (!skeleton) skeleton = child.skeleton;
        }
      });

      if (skeleton && skinnedMeshes.length > 0) {
        this.cachedScene = gltf.scene;
        this.cachedSkeleton = skeleton;
        this.cachedSkinnedMeshes = skinnedMeshes;
        this.loaded = true;
        console.log("Bean character loaded successfully.");
      } else {
        console.warn("Bean character GLB loaded but no skinned meshes found, falling back.");
        this.failed = true;
      }
    } catch (e) {
      // This is expected when the GLB hasn't been generated yet
      console.info("Bean character GLB not found (run Blender script to generate). Using blob primitives.", e);
      this.failed = true;
    }
  }

  /** Check if the bean mesh loaded successfully. */
  isLoaded(): boolean {
    return this.loaded;
  }

  /** Check if loading was attempted and failed. */
  hasFailed(): boolean {
    return this.failed;
  }

  /**
   * Clone the bean character for a player instance.
   * Returns a new Group with cloned SkinnedMeshes and independent skeleton.
   */
  cloneBean(): {
    group: THREE.Group;
    skinnedMeshes: THREE.SkinnedMesh[];
    skeleton: THREE.Skeleton;
    bonesByName: Map<string, THREE.Bone>;
  } | null {
    if (!this.cachedScene) return null;

    const group = cloneSkinnedGroup(this.cachedScene);

    const skinnedMeshes: THREE.SkinnedMesh[] = [];
    const skeletonRef: { value: THREE.Skeleton | null } = { value: null };

    group.traverse((child) => {
      if (child instanceof THREE.SkinnedMesh) {
        skinnedMeshes.push(child);
        if (!skeletonRef.value) skeletonRef.value = child.skeleton;
      }
    });

    const skeleton = skeletonRef.value;
    if (!skeleton) return null;

    // Build bone lookup by name
    const bonesByName = new Map<string, THREE.Bone>();
    for (const bone of skeleton.bones) {
      bonesByName.set(bone.name, bone);
    }

    return { group, skinnedMeshes, skeleton, bonesByName };
  }
}

// ── SkinnedMesh cloning helper ──

/**
 * Clone a Group containing SkinnedMeshes. Three.js's built-in clone()
 * doesn't properly handle SkinnedMesh (skeleton references break).
 * This does a manual deep clone with proper skeleton rebinding.
 */
function cloneSkinnedGroup(source: THREE.Group): THREE.Group {
  // Map from source bones to cloned bones
  const sourceToDest = new Map<THREE.Object3D, THREE.Object3D>();

  // Deep clone the entire hierarchy
  const cloned = source.clone(true);

  // Build mapping by traversing both trees in parallel
  const sourceList: THREE.Object3D[] = [];
  const clonedList: THREE.Object3D[] = [];
  source.traverse((obj) => sourceList.push(obj));
  cloned.traverse((obj) => clonedList.push(obj));

  for (let i = 0; i < sourceList.length; i++) {
    sourceToDest.set(sourceList[i], clonedList[i]);
  }

  // Fix SkinnedMesh skeleton bindings
  cloned.traverse((child) => {
    if (child instanceof THREE.SkinnedMesh) {
      // Find the source skinned mesh
      const idx = clonedList.indexOf(child);
      const srcMesh = sourceList[idx] as THREE.SkinnedMesh;
      if (!srcMesh?.skeleton) return;

      // Rebuild skeleton with cloned bones
      const newBones: THREE.Bone[] = [];
      for (const srcBone of srcMesh.skeleton.bones) {
        const destBone = sourceToDest.get(srcBone) as THREE.Bone | undefined;
        if (destBone) newBones.push(destBone);
      }

      const newSkeleton = new THREE.Skeleton(newBones, srcMesh.skeleton.boneInverses.map((m) => m.clone()));
      child.bind(newSkeleton);

      // Clone material so each player can have different colors
      child.material = (child.material as THREE.Material).clone();
    }
  });

  return cloned;
}
