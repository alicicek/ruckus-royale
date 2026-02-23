/**
 * Active ragdoll system for Ruckus Royale.
 *
 * Each player character is represented by a 10-body ragdoll skeleton connected
 * by PD-controlled joints. The ragdoll tracks a "target pose" driven by the
 * game state (idle, walking, hit, knockout) and the Rapier motor system pulls
 * the physical bodies toward that pose. External forces (hits, knockback) cause
 * natural deformation that the motors then recover from.
 *
 * Architecture:
 *   Capsule movement controller (existing) → drives root/torso position
 *   Ragdoll skeleton (this file)           → drives visual body part positions
 *   Three.js mesh                          → reads ragdoll bone transforms
 */

import RAPIER from "@dimforge/rapier3d-compat";
import {
  RAGDOLL_TORSO_HALF_HEIGHT,
  RAGDOLL_TORSO_RADIUS,
  RAGDOLL_HEAD_RADIUS,
  RAGDOLL_UPPER_ARM_HALF_LENGTH,
  RAGDOLL_LOWER_ARM_HALF_LENGTH,
  RAGDOLL_THIGH_HALF_LENGTH,
  RAGDOLL_SHIN_HALF_LENGTH,
  RAGDOLL_LIMB_RADIUS,
  RAGDOLL_PD,
  RAGDOLL_LIMITS,
  COLLISION_GROUP_ENVIRONMENT,
  RAGDOLL_HIT_STIFFNESS_DROP,
  RAGDOLL_HIT_RECOVERY_RATE,
  RAGDOLL_KNOCKOUT_RECOVERY_TIME,
  RAGDOLL_LIGHT_HIT_IMPULSE,
  RAGDOLL_HEAVY_HIT_IMPULSE,
  RAGDOLL_LIMB_RECOVERY_ORDER,
  RAGDOLL_GRAB_STIFFNESS,
  RAGDOLL_GRAB_DAMPING,
  RAGDOLL_THROW_IMPULSE,
  RAGDOLL_THROW_UPWARD,
  RAGDOLL_GRAB_STIFFNESS_DROP,
  RAGDOLL_MAX_STIFFNESS_ACTIVE,
  RAGDOLL_LIMB_MAX_STIFFNESS,
  LEAN_ACCELERATION_FACTOR,
  LEAN_MAX_PITCH,
  LEAN_MAX_ROLL,
  LEAN_DECAY_RATE,
  LEAN_LANDING_IMPULSE,
  IDLE_SWAY_AMPLITUDE,
  IDLE_SWAY_FREQUENCY,
} from "@ruckus/shared";

// ── Types ──

export interface RagdollBoneTransform {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

export type BoneName =
  | "torso"
  | "head"
  | "l_upper_arm"
  | "r_upper_arm"
  | "l_lower_arm"
  | "r_lower_arm"
  | "l_thigh"
  | "r_thigh"
  | "l_shin"
  | "r_shin";

export type RagdollState = "active" | "hit_reaction" | "knockout" | "recovering";

export type AttackType = "none" | "light" | "heavy";
export type AttackPhase = "idle" | "windup" | "strike" | "followthrough";

export interface RagdollInstance {
  bodies: Map<BoneName, RAPIER.RigidBody>;
  joints: Map<string, RAPIER.ImpulseJoint>;
  state: RagdollState;
  stiffnessScale: number; // 0 = full ragdoll, 1 = full control
  /** Per-limb stiffness for graduated recovery (torso first, arms last) */
  limbStiffness: Map<BoneName, number>;
  hitTimer: number;
  recoveryTimer: number;
  /** Which body part was last hit (for directional reaction) */
  lastHitBone: BoneName | null;
  /** Attack pose state */
  attackType: AttackType;
  attackTimer: number;
  attackPhase: AttackPhase;
  attackArm: "left" | "right";
  leanPitchRad: number;
  leanRollRad: number;
  prevVelX: number;
  prevVelZ: number;
  idleSwayPhase: number;
  wasAirborne: boolean;
  landingStiffnessTimer: number;
  /** Animation-derived target world positions for PD tracking */
  animTargetPositions: Map<BoneName, { x: number; y: number; z: number }>;
  /** Animation-derived target local quaternions for revolute joint motors */
  animTargetQuaternions: Map<BoneName, { x: number; y: number; z: number; w: number }>;
  /** Whether animation targets are available this frame */
  hasAnimTargets: boolean;
}

/**
 * The server capsule controller centers the player at floorY + PLAYER_RADIUS (0.45).
 * The ragdoll's legs are much longer than the capsule radius, so we raise the
 * torso in the ragdoll world so the feet naturally reach the floor.
 *
 * Calculation:
 *   Foot radius:    LIMB_RADIUS * 0.85 ≈ 0.085
 *   Shin length:    2 * SHIN_HALF_LENGTH  = 0.44
 *   Thigh length:   2 * THIGH_HALF_LENGTH = 0.44
 *   Hip offset:     TORSO_HALF_HEIGHT     = 0.35
 *   Total (straight legs): 0.085 + 0.44 + 0.44 + 0.35 = 1.315
 *   With natural knee bend (~15°): ~1.1
 *   Server position.y on ground: 0.45
 *   Offset: 1.1 - 0.45 = 0.65
 */
const RAGDOLL_VISUAL_OFFSET_Y = 0.65;

// ── Collision group helpers ──

function collisionGroup(membershipBit: number, filterMask: number): number {
  return ((membershipBit & 0xffff) << 16) | (filterMask & 0xffff);
}

/**
 * Each ragdoll gets its own group bit (1-15). Limbs collide with environment
 * and OTHER ragdolls, but NOT with their own ragdoll's limbs.
 */
function ragdollCollisionGroup(ragdollIndex: number): number {
  const selfBit = 1 << ((ragdollIndex % 15) + 1); // bits 1-15
  const allRagdolls = 0xfffe;
  const filterMask = (allRagdolls & ~selfBit) | COLLISION_GROUP_ENVIRONMENT;
  return collisionGroup(selfBit, filterMask);
}

// ── Ragdoll Manager ──

/** Active grab joint between two players */
interface GrabJointInfo {
  joint: RAPIER.ImpulseJoint;
  grabberId: string;
  targetId: string;
}

export class RagdollManager {
  private readonly world: RAPIER.World;
  private readonly ragdolls = new Map<string, RagdollInstance>();
  private readonly grabJoints = new Map<string, GrabJointInfo>(); // keyed by grabberId
  private ragdollIndexCounter = 0;

  private floorBody: RAPIER.RigidBody | null = null;

  constructor() {
    // Zero gravity for the ragdoll world — the root body is kinematically
    // positioned by the game's capsule movement system, and limbs use
    // PD motors. Real gravity would fight the motors and cause drift.
    // Instead we apply a gentle downward pull per-limb for natural sag.
    this.world = new RAPIER.World({ x: 0, y: -15.0, z: 0 });

    // Create a static ground plane collider so ragdoll limbs rest on
    // the floor surface instead of clipping through it.
    // The server floor is at Y=0; the collider top surface sits at Y=0.
    this.createFloorCollider();
  }

  /** Create a static floor collider in the ragdoll world at the arena surface. */
  private createFloorCollider(): void {
    const floorHalfHeight = 0.25;
    const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -floorHalfHeight, 0);
    this.floorBody = this.world.createRigidBody(desc);

    // Large box covering the arena. Use COLLISION_GROUP_ENVIRONMENT (bit 0)
    // so ragdoll limbs (which filter against that bit) collide with it.
    const envGroup = collisionGroup(COLLISION_GROUP_ENVIRONMENT, 0xffff);
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(30, floorHalfHeight, 20)
        .setCollisionGroups(envGroup)
        .setFriction(0.6)
        .setRestitution(0.05),
      this.floorBody,
    );
  }

  /** Get or create a ragdoll for the given player id. */
  ensure(id: string): RagdollInstance {
    const existing = this.ragdolls.get(id);
    if (existing) return existing;

    const ragdollIdx = this.ragdollIndexCounter++;
    const instance = createRagdoll(this.world, ragdollIdx);
    this.ragdolls.set(id, instance);
    return instance;
  }

  /** Remove ragdolls for players no longer present. */
  prune(activeIds: Set<string>): void {
    for (const [id, instance] of this.ragdolls.entries()) {
      if (activeIds.has(id)) continue;
      // Clean up any grab joints involving this player
      this.releaseGrabJoint(id);
      for (const [grabberId, info] of this.grabJoints) {
        if (info.targetId === id) {
          this.releaseGrabJoint(grabberId);
        }
      }
      // Remove all bodies from the world
      for (const body of instance.bodies.values()) {
        this.world.removeRigidBody(body);
      }
      this.ragdolls.delete(id);
    }
  }

  /**
   * Drive the ragdoll's root (torso) to follow the capsule controller position.
   * Also sets PD motor targets based on current state.
   */
  driveToPosition(
    id: string,
    position: { x: number; y: number; z: number },
    velocity: { x: number; y: number; z: number },
    facingYaw: number,
    stun: number,
    dt: number,
    isSprinting = false,
  ): void {
    const ragdoll = this.ensure(id);
    ragdoll.hasAnimTargets = false;

    // Raise the torso so ragdoll legs can reach the floor naturally
    const raisedPos = { x: position.x, y: position.y + RAGDOLL_VISUAL_OFFSET_Y, z: position.z };

    // On first positioning or large teleport, snap ALL bodies to proper positions
    const torso = ragdoll.bodies.get("torso")!;
    const currentPos = torso.translation();
    const dx = raisedPos.x - currentPos.x;
    const dy = raisedPos.y - currentPos.y;
    const dz = raisedPos.z - currentPos.z;
    const distSq = dx * dx + dy * dy + dz * dz;

    if (distSq > 4.0) {
      // Teleport: snap all bodies to proper positions relative to target
      this.teleportAll(ragdoll, raisedPos, facingYaw);
    } else {
      // Normal: only move torso kinematically, limbs follow via joints
      torso.setTranslation(raisedPos, true);

      // ── Torso lean system (Gang Beasts "balancing on a ball") ──
      // Compute acceleration from velocity delta
      const accelX = (velocity.x - ragdoll.prevVelX) / Math.max(dt, 1/120);
      const accelZ = (velocity.z - ragdoll.prevVelZ) / Math.max(dt, 1/120);
      ragdoll.prevVelX = velocity.x;
      ragdoll.prevVelZ = velocity.z;

      // Convert acceleration to local-space lean (forward = pitch, lateral = roll)
      const cosYaw = Math.cos(facingYaw);
      const sinYaw = Math.sin(facingYaw);
      const localAccelForward = accelX * sinYaw + accelZ * cosYaw;
      const localAccelLateral = accelX * cosYaw - accelZ * sinYaw;

      // Target lean from acceleration
      const targetPitch = -localAccelForward * LEAN_ACCELERATION_FACTOR;
      const targetRoll = localAccelLateral * LEAN_ACCELERATION_FACTOR;

      // Smooth lean with exponential decay toward target
      const decayFactor = 1 - Math.exp(-LEAN_DECAY_RATE * dt);
      ragdoll.leanPitchRad += (targetPitch - ragdoll.leanPitchRad) * decayFactor;
      ragdoll.leanRollRad += (targetRoll - ragdoll.leanRollRad) * decayFactor;

      // Add idle sway when nearly stationary
      const speed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
      const idleBlend = Math.max(0, 1 - speed * 0.5);
      ragdoll.idleSwayPhase += dt * IDLE_SWAY_FREQUENCY * Math.PI * 2;
      ragdoll.leanRollRad += Math.sin(ragdoll.idleSwayPhase) * IDLE_SWAY_AMPLITUDE * idleBlend;
      ragdoll.leanPitchRad += Math.sin(ragdoll.idleSwayPhase * 0.7 + 1.3) * IDLE_SWAY_AMPLITUDE * 0.5 * idleBlend;

      // Clamp lean angles
      ragdoll.leanPitchRad = Math.max(-LEAN_MAX_PITCH, Math.min(LEAN_MAX_PITCH, ragdoll.leanPitchRad));
      ragdoll.leanRollRad = Math.max(-LEAN_MAX_ROLL, Math.min(LEAN_MAX_ROLL, ragdoll.leanRollRad));

      // Landing detection
      const airborne = position.y > 0.6;
      if (ragdoll.wasAirborne && !airborne) {
        // Just landed — apply landing effects
        ragdoll.landingStiffnessTimer = 0.3;
        ragdoll.leanPitchRad += LEAN_LANDING_IMPULSE;
        // Apply downward impulse to all limbs for "squish" effect
        for (const [name, body] of ragdoll.bodies) {
          if (name === "torso") continue;
          body.applyImpulse({ x: 0, y: -2.0, z: 0 }, true);
        }
      }
      ragdoll.wasAirborne = airborne;

      // Landing stiffness reduction
      if (ragdoll.landingStiffnessTimer > 0) {
        ragdoll.landingStiffnessTimer -= dt;
        const landingFactor = 0.6;
        ragdoll.stiffnessScale *= landingFactor;
        for (const [limbName] of ragdoll.bodies) {
          const current = ragdoll.limbStiffness.get(limbName) ?? 0.75;
          ragdoll.limbStiffness.set(limbName, current * landingFactor);
        }
      }

      // Compose lean rotation with facing yaw
      const leanQuat = composeLeanQuat(facingYaw, ragdoll.leanPitchRad, ragdoll.leanRollRad);
      torso.setRotation(leanQuat, true);
    }

    // Update state machine
    this.updateState(ragdoll, stun, dt);

    // Compute pose targets based on movement
    const speed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
    const isMoving = speed > 0.5;
    const now = performance.now() / 1000;

    // Update attack timer
    if (ragdoll.attackType !== "none") {
      ragdoll.attackTimer -= dt;
      if (ragdoll.attackTimer <= 0) {
        ragdoll.attackType = "none";
        ragdoll.attackPhase = "idle";
        ragdoll.attackTimer = 0;
      } else if (ragdoll.attackType === "heavy") {
        // Heavy attack phase transitions: windup (first 40%), strike (next 35%), followthrough (last 25%)
        const totalDuration = 0.5;
        const elapsed = totalDuration - ragdoll.attackTimer;
        const progress = elapsed / totalDuration;
        if (progress < 0.4) ragdoll.attackPhase = "windup";
        else if (progress < 0.75) ragdoll.attackPhase = "strike";
        else ragdoll.attackPhase = "followthrough";
      }
    }

    // Apply PD motor targets with current stiffness scale
    const scale = ragdoll.stiffnessScale;
    applyMotorTargets(ragdoll, scale, isMoving, now, speed, dt, isSprinting);
  }

  /** Teleport all ragdoll bodies to proper positions relative to a target root position. */
  private teleportAll(
    ragdoll: RagdollInstance,
    position: { x: number; y: number; z: number },
    facingYaw: number,
  ): void {
    const quat = yawToQuat(facingYaw);
    const px = position.x;
    const py = position.y;
    const pz = position.z;

    const shoulderX = RAGDOLL_TORSO_RADIUS + RAGDOLL_UPPER_ARM_HALF_LENGTH + 0.02;
    const hipX = 0.12;

    // Define rest-pose offsets relative to torso center
    const offsets: Record<string, { x: number; y: number; z: number }> = {
      torso:       { x: 0, y: 0, z: 0 },
      head:        { x: 0, y: RAGDOLL_TORSO_HALF_HEIGHT + RAGDOLL_HEAD_RADIUS + 0.08, z: 0 },
      l_upper_arm: { x: -shoulderX, y: RAGDOLL_TORSO_HALF_HEIGHT * 0.7 - RAGDOLL_UPPER_ARM_HALF_LENGTH, z: 0 },
      r_upper_arm: { x: shoulderX, y: RAGDOLL_TORSO_HALF_HEIGHT * 0.7 - RAGDOLL_UPPER_ARM_HALF_LENGTH, z: 0 },
      l_lower_arm: { x: -shoulderX, y: RAGDOLL_TORSO_HALF_HEIGHT * 0.7 - RAGDOLL_UPPER_ARM_HALF_LENGTH * 2 - RAGDOLL_LOWER_ARM_HALF_LENGTH - 0.02, z: 0 },
      r_lower_arm: { x: shoulderX, y: RAGDOLL_TORSO_HALF_HEIGHT * 0.7 - RAGDOLL_UPPER_ARM_HALF_LENGTH * 2 - RAGDOLL_LOWER_ARM_HALF_LENGTH - 0.02, z: 0 },
      l_thigh:     { x: -hipX, y: -RAGDOLL_TORSO_HALF_HEIGHT - RAGDOLL_THIGH_HALF_LENGTH, z: 0 },
      r_thigh:     { x: hipX, y: -RAGDOLL_TORSO_HALF_HEIGHT - RAGDOLL_THIGH_HALF_LENGTH, z: 0 },
      l_shin:      { x: -hipX, y: -RAGDOLL_TORSO_HALF_HEIGHT - RAGDOLL_THIGH_HALF_LENGTH * 2 - RAGDOLL_SHIN_HALF_LENGTH - 0.02, z: 0 },
      r_shin:      { x: hipX, y: -RAGDOLL_TORSO_HALF_HEIGHT - RAGDOLL_THIGH_HALF_LENGTH * 2 - RAGDOLL_SHIN_HALF_LENGTH - 0.02, z: 0 },
    };

    for (const [name, body] of ragdoll.bodies) {
      const offset = offsets[name];
      if (!offset) continue;

      // Rotate offset by facing yaw
      const rotated = rotateByQuat(offset, quat);
      const worldPos = {
        x: px + rotated.x,
        y: py + rotated.y,
        z: pz + rotated.z,
      };

      body.setTranslation(worldPos, true);
      body.setRotation(quat, true);
      // Reset velocities on teleport
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  /** Apply a hit impulse to a specific body part. */
  applyHitImpulse(
    id: string,
    direction: { x: number; y: number; z: number },
    magnitude: number,
    isHeavy: boolean,
    targetBone?: BoneName,
  ): void {
    const ragdoll = this.ragdolls.get(id);
    if (!ragdoll) return; // Don't auto-create for hit events

    const tuning = isHeavy ? RAGDOLL_HEAVY_HIT_IMPULSE : RAGDOLL_LIGHT_HIT_IMPULSE;

    // Pick a body part to hit — prioritize the specified bone, else pick based on chance
    const bone = targetBone ?? this.pickHitBone(isHeavy);
    const body = ragdoll.bodies.get(bone);
    if (!body) return;

    // Apply impulse to the struck body part
    body.applyImpulse(
      {
        x: direction.x * magnitude * tuning.directional,
        y: direction.y * magnitude * tuning.upward + magnitude * tuning.upward,
        z: direction.z * magnitude * tuning.directional,
      },
      true,
    );

    // For heavy attacks, also add a spin torque for more dramatic effect
    if (isHeavy) {
      body.applyTorqueImpulse(
        {
          x: direction.z * magnitude * 0.03,
          y: 0,
          z: -direction.x * magnitude * 0.03,
        },
        true,
      );
      // Spread impulse to adjacent body parts for full-body reaction
      for (const [adjName, adjBody] of ragdoll.bodies) {
        if (adjName === bone) continue;
        adjBody.applyImpulse(
          {
            x: direction.x * magnitude * tuning.directional * 0.3,
            y: magnitude * tuning.upward * 0.2,
            z: direction.z * magnitude * tuning.directional * 0.3,
          },
          true,
        );
      }
    }

    // Drop stiffness temporarily
    ragdoll.state = "hit_reaction";
    ragdoll.stiffnessScale = tuning.stiffnessDrop;
    ragdoll.hitTimer = tuning.duration;
    ragdoll.lastHitBone = bone;

    // Set per-limb stiffness — hit bone drops more, adjacent bones drop partially
    for (const [limbName] of ragdoll.bodies) {
      if (limbName === bone) {
        ragdoll.limbStiffness.set(limbName, tuning.stiffnessDrop * 0.5);
      } else {
        ragdoll.limbStiffness.set(
          limbName,
          Math.min(ragdoll.limbStiffness.get(limbName) ?? 1, tuning.stiffnessDrop),
        );
      }
    }
  }

  /** Pick a body part to receive hit based on attack type */
  private pickHitBone(isHeavy: boolean): BoneName {
    const r = Math.random();
    if (isHeavy) {
      // Heavy attacks tend to hit torso/head (big swing)
      if (r < 0.35) return "torso";
      if (r < 0.55) return "head";
      if (r < 0.7) return Math.random() < 0.5 ? "l_upper_arm" : "r_upper_arm";
      return Math.random() < 0.5 ? "l_thigh" : "r_thigh";
    }
    // Light attacks hit more varied body parts
    if (r < 0.25) return "torso";
    if (r < 0.35) return "head";
    if (r < 0.55) return Math.random() < 0.5 ? "l_upper_arm" : "r_upper_arm";
    if (r < 0.75) return Math.random() < 0.5 ? "l_lower_arm" : "r_lower_arm";
    return Math.random() < 0.5 ? "l_thigh" : "r_thigh";
  }

  /** Trigger full ragdoll knockout. */
  setKnockout(id: string): void {
    const ragdoll = this.ragdolls.get(id);
    if (!ragdoll) return;

    ragdoll.state = "knockout";
    ragdoll.stiffnessScale = 0;
    ragdoll.recoveryTimer = RAGDOLL_KNOCKOUT_RECOVERY_TIME;

    // Zero all per-limb stiffness for full ragdoll collapse
    for (const [limbName] of ragdoll.bodies) {
      ragdoll.limbStiffness.set(limbName, 0);
    }

    // Apply a small collapse impulse to make the knockout dramatic
    const torso = ragdoll.bodies.get("torso");
    if (torso) {
      // Random fall direction for variety
      const angle = Math.random() * Math.PI * 2;
      for (const [name, body] of ragdoll.bodies) {
        if (name === "torso") continue; // torso is kinematic
        body.applyImpulse(
          {
            x: Math.cos(angle) * 2,
            y: -1.5,
            z: Math.sin(angle) * 2,
          },
          true,
        );
      }
    }
  }

  /** Trigger an attack pose animation on a ragdoll. */
  triggerAttackPose(id: string, type: "light" | "heavy"): void {
    const ragdoll = this.ragdolls.get(id);
    if (!ragdoll) return;
    // Alternate arms each attack
    ragdoll.attackArm = ragdoll.attackArm === "left" ? "right" : "left";
    ragdoll.attackType = type;
    ragdoll.attackTimer = type === "light" ? 0.3 : 0.5;
    ragdoll.attackPhase = type === "heavy" ? "windup" : "strike";
  }

  /** Set animation-derived target positions/quaternions for PD tracking. */
  setAnimationTargets(
    id: string,
    positions: Map<BoneName, { x: number; y: number; z: number }>,
    quaternions: Map<BoneName, { x: number; y: number; z: number; w: number }>,
  ): void {
    const ragdoll = this.ragdolls.get(id);
    if (!ragdoll) return;
    ragdoll.animTargetPositions = positions;
    ragdoll.animTargetQuaternions = quaternions;
    ragdoll.hasAnimTargets = true;
  }

  /**
   * Create a physics spring joint between grabber's hand and target's torso.
   * This gives the grab a physical, wobbly feel instead of a hard position lock.
   */
  createGrabJoint(grabberId: string, targetId: string): void {
    // Remove existing grab joint for this grabber
    this.releaseGrabJoint(grabberId);

    const grabber = this.ragdolls.get(grabberId);
    const target = this.ragdolls.get(targetId);
    if (!grabber || !target) return;

    // Pick a hand for the grabber (alternate left/right)
    const hand = Math.random() < 0.5 ? "r_lower_arm" : "l_lower_arm";
    const grabberBody = grabber.bodies.get(hand as BoneName);
    const targetBody = target.bodies.get("torso");
    if (!grabberBody || !targetBody) return;

    // Create a spring joint between hand and target torso
    const jointData = RAPIER.JointData.spring(
      0.5, // rest length (more visible spring wobble)
      RAGDOLL_GRAB_STIFFNESS,
      RAGDOLL_GRAB_DAMPING,
      { x: 0, y: -RAGDOLL_LOWER_ARM_HALF_LENGTH, z: 0 }, // anchor on hand (tip of forearm)
      { x: 0, y: 0, z: 0 }, // anchor on target torso center
    );

    const joint = this.world.createImpulseJoint(jointData, grabberBody, targetBody, true);
    joint.setContactsEnabled(false);

    this.grabJoints.set(grabberId, { joint, grabberId, targetId });

    // Reduce target stiffness while grabbed (ragdolly feel)
    target.stiffnessScale = Math.min(target.stiffnessScale, RAGDOLL_GRAB_STIFFNESS_DROP);
    for (const [limbName] of target.bodies) {
      target.limbStiffness.set(
        limbName,
        Math.min(target.limbStiffness.get(limbName) ?? 1, RAGDOLL_GRAB_STIFFNESS_DROP),
      );
    }
  }

  /**
   * Release the grab joint and optionally apply throw impulse.
   * @param applyThrow If true, applies directional throw impulse to the target.
   * @param throwDir Direction to throw (from grabber to target).
   */
  releaseGrabJoint(
    grabberId: string,
    applyThrow = false,
    throwDir?: { x: number; y: number; z: number },
  ): void {
    const grabInfo = this.grabJoints.get(grabberId);
    if (!grabInfo) return;

    // Remove the physics joint
    this.world.removeImpulseJoint(grabInfo.joint, true);
    this.grabJoints.delete(grabberId);

    // Apply throw impulse to ALL target body parts for full-body throw feel
    if (applyThrow) {
      const target = this.ragdolls.get(grabInfo.targetId);
      if (target) {
        const dir = throwDir ?? { x: 0, y: 0.5, z: 1 };
        const len = Math.max(0.1, Math.hypot(dir.x, dir.y, dir.z));
        const nx = dir.x / len;
        const ny = dir.y / len;
        const nz = dir.z / len;

        for (const [, body] of target.bodies) {
          body.applyImpulse(
            {
              x: nx * RAGDOLL_THROW_IMPULSE,
              y: ny * RAGDOLL_THROW_IMPULSE * 0.5 + RAGDOLL_THROW_UPWARD,
              z: nz * RAGDOLL_THROW_IMPULSE,
            },
            true,
          );
        }

        // Drop stiffness for dramatic throw wobble
        target.state = "hit_reaction";
        target.stiffnessScale = 0.2;
        target.hitTimer = 0.5;
        for (const [limbName] of target.bodies) {
          target.limbStiffness.set(limbName, 0.15);
        }
      }
    }
  }

  /** Step the physics world. */
  step(dt: number): void {
    this.world.timestep = Math.min(dt, 1 / 30);
    this.world.step();
  }

  /** Read the transform of a specific bone. */
  getBoneTransform(id: string, bone: BoneName): RagdollBoneTransform | null {
    const ragdoll = this.ragdolls.get(id);
    if (!ragdoll) return null;

    const body = ragdoll.bodies.get(bone);
    if (!body) return null;

    const pos = body.translation();
    const rot = body.rotation();
    return { x: pos.x, y: pos.y, z: pos.z, qx: rot.x, qy: rot.y, qz: rot.z, qw: rot.w };
  }

  /** Get the current stiffness scale for a player (0 = full ragdoll, 1 = full control). */
  getStiffness(id: string): number | null {
    const ragdoll = this.ragdolls.get(id);
    if (!ragdoll) return null;
    return ragdoll.stiffnessScale;
  }

  /** Read all bone transforms for a player. */
  getAllBoneTransforms(id: string): Map<BoneName, RagdollBoneTransform> | null {
    const ragdoll = this.ragdolls.get(id);
    if (!ragdoll) return null;

    const result = new Map<BoneName, RagdollBoneTransform>();
    for (const [name, body] of ragdoll.bodies) {
      const pos = body.translation();
      const rot = body.rotation();
      result.set(name, { x: pos.x, y: pos.y, z: pos.z, qx: rot.x, qy: rot.y, qz: rot.z, qw: rot.w });
    }
    return result;
  }

  private updateState(ragdoll: RagdollInstance, stun: number, dt: number): void {
    switch (ragdoll.state) {
      case "hit_reaction":
        ragdoll.hitTimer -= dt;
        if (ragdoll.hitTimer <= 0) {
          ragdoll.state = "recovering";
          ragdoll.hitTimer = 0;
        }
        break;

      case "knockout":
        ragdoll.recoveryTimer -= dt;
        if (ragdoll.recoveryTimer <= 0) {
          ragdoll.state = "recovering";
          ragdoll.recoveryTimer = 0;
        }
        break;

      case "recovering": {
        // Per-limb graduated recovery: torso first, arms last
        let allRecovered = true;
        for (const [limbName] of ragdoll.bodies) {
          const order = RAGDOLL_LIMB_RECOVERY_ORDER[limbName] ?? 0.5;
          // Limbs with lower order values recover faster (earlier in the ramp)
          const limbRate = RAGDOLL_HIT_RECOVERY_RATE * (1.0 - order * 0.6);
          const current = ragdoll.limbStiffness.get(limbName) ?? 0;
          const limbCap = RAGDOLL_LIMB_MAX_STIFFNESS[limbName] ?? RAGDOLL_MAX_STIFFNESS_ACTIVE;
          const next = Math.min(limbCap, current + limbRate * dt);
          ragdoll.limbStiffness.set(limbName, next);
          if (next < limbCap - 0.01) allRecovered = false;
        }
        // Overall stiffness is the minimum limb stiffness (conservative), capped
        let minStiffness = RAGDOLL_MAX_STIFFNESS_ACTIVE;
        for (const val of ragdoll.limbStiffness.values()) {
          if (val < minStiffness) minStiffness = val;
        }
        ragdoll.stiffnessScale = minStiffness;

        if (allRecovered) {
          ragdoll.stiffnessScale = RAGDOLL_MAX_STIFFNESS_ACTIVE;
          ragdoll.state = "active";
          for (const [limbName] of ragdoll.bodies) {
            const limbCap2 = RAGDOLL_LIMB_MAX_STIFFNESS[limbName] ?? RAGDOLL_MAX_STIFFNESS_ACTIVE;
            ragdoll.limbStiffness.set(limbName, limbCap2);
          }
        }
        break;
      }

      case "active": {
        // Stun reduces stiffness slightly for wobble effect
        const baseStiffness = 1 - Math.min(0.5, stun * 0.005);
        ragdoll.stiffnessScale = Math.min(baseStiffness, RAGDOLL_MAX_STIFFNESS_ACTIVE);
        // Keep per-limb stiffness in sync, capped per limb
        for (const [limbName] of ragdoll.bodies) {
          const limbCap = RAGDOLL_LIMB_MAX_STIFFNESS[limbName] ?? RAGDOLL_MAX_STIFFNESS_ACTIVE;
          ragdoll.limbStiffness.set(limbName, Math.min(ragdoll.stiffnessScale, limbCap));
        }
        break;
      }
    }
  }
}

// ── Ragdoll creation ──

function createRagdoll(world: RAPIER.World, ragdollIndex: number): RagdollInstance {
  const bodies = new Map<BoneName, RAPIER.RigidBody>();
  const joints = new Map<string, RAPIER.ImpulseJoint>();
  const group = ragdollCollisionGroup(ragdollIndex);

  // Per-limb damping: arms are floppier, legs stiffer, head in between
  const limbDamping: Record<string, { linear: number; angular: number }> = {
    l_upper_arm: { linear: 1.0, angular: 1.5 },
    r_upper_arm: { linear: 1.0, angular: 1.5 },
    l_lower_arm: { linear: 1.0, angular: 1.5 },
    r_lower_arm: { linear: 1.0, angular: 1.5 },
    l_thigh:     { linear: 2.5, angular: 3.5 },
    r_thigh:     { linear: 2.5, angular: 3.5 },
    l_shin:      { linear: 2.5, angular: 3.5 },
    r_shin:      { linear: 2.5, angular: 3.5 },
    head:        { linear: 2.0, angular: 3.0 },
  };

  // Per-limb friction: shins/thighs get low friction so legs slide on ground
  const limbFriction: Record<string, number> = {
    l_shin: 0.0,
    r_shin: 0.0,
    l_thigh: 0.05,
    r_thigh: 0.05,
  };

  // Helper to create a body part
  function makePart(
    name: BoneName,
    pos: { x: number; y: number; z: number },
    halfHeight: number,
    radius: number,
    isRoot: boolean,
  ): RAPIER.RigidBody {
    const damp = limbDamping[name] ?? { linear: 3.0, angular: 4.0 };
    const desc = isRoot
      ? RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z)
      : RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(pos.x, pos.y, pos.z)
          .setLinearDamping(damp.linear)
          .setAngularDamping(damp.angular);

    const rb = world.createRigidBody(desc);

    if (halfHeight > 0.01) {
      world.createCollider(
        RAPIER.ColliderDesc.capsule(halfHeight, radius)
          .setCollisionGroups(group)
          .setMass(isRoot ? 0 : 1.0)
          .setFriction(limbFriction[name] ?? 0.3)
          .setRestitution(0.05),
        rb,
      );
    } else {
      world.createCollider(
        RAPIER.ColliderDesc.ball(radius)
          .setCollisionGroups(group)
          .setMass(isRoot ? 0 : 0.5)
          .setFriction(limbFriction[name] ?? 0.3)
          .setRestitution(0.05),
        rb,
      );
    }

    bodies.set(name, rb);
    return rb;
  }

  // Create body parts at origin (they'll be positioned by driveToPosition)
  const px = 0, py = 1.0, pz = 0;

  const torso = makePart("torso", { x: px, y: py, z: pz }, RAGDOLL_TORSO_HALF_HEIGHT, RAGDOLL_TORSO_RADIUS, true);

  const headY = py + RAGDOLL_TORSO_HALF_HEIGHT + RAGDOLL_HEAD_RADIUS + 0.08;
  makePart("head", { x: px, y: headY, z: pz }, 0, RAGDOLL_HEAD_RADIUS, false);

  const shoulderY = py + RAGDOLL_TORSO_HALF_HEIGHT * 0.7;
  const shoulderX = RAGDOLL_TORSO_RADIUS + RAGDOLL_UPPER_ARM_HALF_LENGTH + 0.02;

  makePart("l_upper_arm", { x: px - shoulderX, y: shoulderY, z: pz }, RAGDOLL_UPPER_ARM_HALF_LENGTH, RAGDOLL_LIMB_RADIUS, false);
  makePart("r_upper_arm", { x: px + shoulderX, y: shoulderY, z: pz }, RAGDOLL_UPPER_ARM_HALF_LENGTH, RAGDOLL_LIMB_RADIUS, false);

  const elbowY = shoulderY - RAGDOLL_UPPER_ARM_HALF_LENGTH * 2 - 0.02;
  makePart("l_lower_arm", { x: px - shoulderX, y: elbowY, z: pz }, RAGDOLL_LOWER_ARM_HALF_LENGTH, RAGDOLL_LIMB_RADIUS * 0.9, false);
  makePart("r_lower_arm", { x: px + shoulderX, y: elbowY, z: pz }, RAGDOLL_LOWER_ARM_HALF_LENGTH, RAGDOLL_LIMB_RADIUS * 0.9, false);

  const hipY = py - RAGDOLL_TORSO_HALF_HEIGHT;
  const hipX = 0.12;
  makePart("l_thigh", { x: px - hipX, y: hipY - RAGDOLL_THIGH_HALF_LENGTH, z: pz }, RAGDOLL_THIGH_HALF_LENGTH, RAGDOLL_LIMB_RADIUS * 1.1, false);
  makePart("r_thigh", { x: px + hipX, y: hipY - RAGDOLL_THIGH_HALF_LENGTH, z: pz }, RAGDOLL_THIGH_HALF_LENGTH, RAGDOLL_LIMB_RADIUS * 1.1, false);

  const kneeY = hipY - RAGDOLL_THIGH_HALF_LENGTH * 2 - 0.02;
  makePart("l_shin", { x: px - hipX, y: kneeY - RAGDOLL_SHIN_HALF_LENGTH, z: pz }, RAGDOLL_SHIN_HALF_LENGTH, RAGDOLL_LIMB_RADIUS * 0.85, false);
  makePart("r_shin", { x: px + hipX, y: kneeY - RAGDOLL_SHIN_HALF_LENGTH, z: pz }, RAGDOLL_SHIN_HALF_LENGTH, RAGDOLL_LIMB_RADIUS * 0.85, false);

  // ── Create joints ──

  const head = bodies.get("head")!;
  const lUpperArm = bodies.get("l_upper_arm")!;
  const rUpperArm = bodies.get("r_upper_arm")!;
  const lLowerArm = bodies.get("l_lower_arm")!;
  const rLowerArm = bodies.get("r_lower_arm")!;
  const lThigh = bodies.get("l_thigh")!;
  const rThigh = bodies.get("r_thigh")!;
  const lShin = bodies.get("l_shin")!;
  const rShin = bodies.get("r_shin")!;

  // Head → Torso (spherical, stiff)
  const headJoint = world.createImpulseJoint(
    RAPIER.JointData.spherical(
      { x: 0, y: RAGDOLL_TORSO_HALF_HEIGHT + 0.04, z: 0 },
      { x: 0, y: -(RAGDOLL_HEAD_RADIUS + 0.04), z: 0 },
    ),
    torso,
    head,
    true,
  );
  headJoint.setContactsEnabled(false);
  joints.set("head", headJoint);

  // Left Shoulder (spherical)
  const lShoulderJoint = world.createImpulseJoint(
    RAPIER.JointData.spherical(
      { x: -(RAGDOLL_TORSO_RADIUS + 0.01), y: RAGDOLL_TORSO_HALF_HEIGHT * 0.7, z: 0 },
      { x: 0, y: RAGDOLL_UPPER_ARM_HALF_LENGTH, z: 0 },
    ),
    torso,
    lUpperArm,
    true,
  );
  lShoulderJoint.setContactsEnabled(false);
  joints.set("l_shoulder", lShoulderJoint);

  // Right Shoulder (spherical)
  const rShoulderJoint = world.createImpulseJoint(
    RAPIER.JointData.spherical(
      { x: RAGDOLL_TORSO_RADIUS + 0.01, y: RAGDOLL_TORSO_HALF_HEIGHT * 0.7, z: 0 },
      { x: 0, y: RAGDOLL_UPPER_ARM_HALF_LENGTH, z: 0 },
    ),
    torso,
    rUpperArm,
    true,
  );
  rShoulderJoint.setContactsEnabled(false);
  joints.set("r_shoulder", rShoulderJoint);

  // Left Elbow (revolute)
  const lElbowJoint = world.createImpulseJoint(
    RAPIER.JointData.revolute(
      { x: 0, y: -RAGDOLL_UPPER_ARM_HALF_LENGTH, z: 0 },
      { x: 0, y: RAGDOLL_LOWER_ARM_HALF_LENGTH, z: 0 },
      { x: 1, y: 0, z: 0 },
    ),
    lUpperArm,
    lLowerArm,
    true,
  );
  lElbowJoint.setContactsEnabled(false);
  (lElbowJoint as RAPIER.RevoluteImpulseJoint).setLimits(
    RAGDOLL_LIMITS.elbow.min,
    RAGDOLL_LIMITS.elbow.max,
  );
  joints.set("l_elbow", lElbowJoint);

  // Right Elbow (revolute)
  const rElbowJoint = world.createImpulseJoint(
    RAPIER.JointData.revolute(
      { x: 0, y: -RAGDOLL_UPPER_ARM_HALF_LENGTH, z: 0 },
      { x: 0, y: RAGDOLL_LOWER_ARM_HALF_LENGTH, z: 0 },
      { x: 1, y: 0, z: 0 },
    ),
    rUpperArm,
    rLowerArm,
    true,
  );
  rElbowJoint.setContactsEnabled(false);
  (rElbowJoint as RAPIER.RevoluteImpulseJoint).setLimits(
    RAGDOLL_LIMITS.elbow.min,
    RAGDOLL_LIMITS.elbow.max,
  );
  joints.set("r_elbow", rElbowJoint);

  // Left Hip (spherical)
  const lHipJoint = world.createImpulseJoint(
    RAPIER.JointData.spherical(
      { x: -hipX, y: -RAGDOLL_TORSO_HALF_HEIGHT, z: 0 },
      { x: 0, y: RAGDOLL_THIGH_HALF_LENGTH, z: 0 },
    ),
    torso,
    lThigh,
    true,
  );
  lHipJoint.setContactsEnabled(false);
  joints.set("l_hip", lHipJoint);

  // Right Hip (spherical)
  const rHipJoint = world.createImpulseJoint(
    RAPIER.JointData.spherical(
      { x: hipX, y: -RAGDOLL_TORSO_HALF_HEIGHT, z: 0 },
      { x: 0, y: RAGDOLL_THIGH_HALF_LENGTH, z: 0 },
    ),
    torso,
    rThigh,
    true,
  );
  rHipJoint.setContactsEnabled(false);
  joints.set("r_hip", rHipJoint);

  // Left Knee (revolute)
  const lKneeJoint = world.createImpulseJoint(
    RAPIER.JointData.revolute(
      { x: 0, y: -RAGDOLL_THIGH_HALF_LENGTH, z: 0 },
      { x: 0, y: RAGDOLL_SHIN_HALF_LENGTH, z: 0 },
      { x: 1, y: 0, z: 0 },
    ),
    lThigh,
    lShin,
    true,
  );
  lKneeJoint.setContactsEnabled(false);
  (lKneeJoint as RAPIER.RevoluteImpulseJoint).setLimits(
    RAGDOLL_LIMITS.knee.min,
    RAGDOLL_LIMITS.knee.max,
  );
  joints.set("l_knee", lKneeJoint);

  // Right Knee (revolute)
  const rKneeJoint = world.createImpulseJoint(
    RAPIER.JointData.revolute(
      { x: 0, y: -RAGDOLL_THIGH_HALF_LENGTH, z: 0 },
      { x: 0, y: RAGDOLL_SHIN_HALF_LENGTH, z: 0 },
      { x: 1, y: 0, z: 0 },
    ),
    rThigh,
    rShin,
    true,
  );
  rKneeJoint.setContactsEnabled(false);
  (rKneeJoint as RAPIER.RevoluteImpulseJoint).setLimits(
    RAGDOLL_LIMITS.knee.min,
    RAGDOLL_LIMITS.knee.max,
  );
  joints.set("r_knee", rKneeJoint);

  // Configure initial motor targets on revolute joints
  for (const [name, joint] of joints) {
    if (name.includes("elbow") || name.includes("knee")) {
      const rev = joint as RAPIER.RevoluteImpulseJoint;
      const pd = name.includes("elbow") ? RAGDOLL_PD.elbow : RAGDOLL_PD.knee;
      rev.configureMotorPosition(0, pd.kp, pd.kd);
    }
  }

  // Initialize per-limb stiffness
  const limbStiffness = new Map<BoneName, number>();
  for (const name of bodies.keys()) {
    limbStiffness.set(name, 1);
  }

  return {
    bodies,
    joints,
    state: "active",
    stiffnessScale: 1,
    limbStiffness,
    hitTimer: 0,
    recoveryTimer: 0,
    lastHitBone: null,
    attackType: "none",
    attackTimer: 0,
    attackPhase: "idle",
    attackArm: "right",
    leanPitchRad: 0,
    leanRollRad: 0,
    prevVelX: 0,
    prevVelZ: 0,
    idleSwayPhase: Math.random() * Math.PI * 2,
    wasAirborne: false,
    landingStiffnessTimer: 0,
    animTargetPositions: new Map(),
    animTargetQuaternions: new Map(),
    hasAnimTargets: false,
  };
}

// ── Motor target application ──

function applyMotorTargets(
  ragdoll: RagdollInstance,
  _stiffnessScale: number,
  isMoving: boolean,
  timeSec: number,
  speed: number,
  _dt: number,
  isSprinting = false,
): void {
  // Helper to get per-limb stiffness
  const limbScale = (bone: BoneName): number => ragdoll.limbStiffness.get(bone) ?? _stiffnessScale;

  // Determine if attack is active and which arm
  const attacking = ragdoll.attackType !== "none";
  const atkSide = ragdoll.attackArm; // "left" or "right"
  const atkPrefix = atkSide === "left" ? "l_" : "r_";

  // Walk cycle frequency: faster when sprinting
  const walkFreq = isSprinting ? 12 : 8;

  // Revolute joints (elbows, knees) — set motor targets
  for (const [name, joint] of ragdoll.joints) {
    if (name.includes("elbow")) {
      const rev = joint as RAPIER.RevoluteImpulseJoint;
      const pd = RAGDOLL_PD.elbow;
      const boneName = (name.includes("l_") ? "l_lower_arm" : "r_lower_arm") as BoneName;
      const scale = limbScale(boneName);

      // Check if this is the attacking arm's elbow
      if (attacking && name.startsWith(atkPrefix)) {
        let elbowTarget = 0;
        if (ragdoll.attackType === "light") {
          elbowTarget = 0.1;
        } else {
          if (ragdoll.attackPhase === "windup") elbowTarget = 2.0;
          else if (ragdoll.attackPhase === "strike") elbowTarget = 0.2;
          else elbowTarget = 0.8;
        }
        rev.configureMotorPosition(elbowTarget, pd.kp * scale * 1.5, pd.kd * scale * 1.5);
      } else {
        // Check for animation target
        if (ragdoll.hasAnimTargets) {
          const animBone = (name.includes("l_") ? "l_lower_arm" : "r_lower_arm") as BoneName;
          const animQ = ragdoll.animTargetQuaternions.get(animBone);
          if (animQ) {
            // Extract rotation around X axis (the elbow hinge axis)
            const sinHalfAngle = Math.sqrt(animQ.x * animQ.x);
            const angle = 2 * Math.atan2(sinHalfAngle, animQ.w);
            const clampedAngle = Math.max(RAGDOLL_LIMITS.elbow.min, Math.min(RAGDOLL_LIMITS.elbow.max, angle));
            rev.configureMotorPosition(clampedAngle, pd.kp * scale, pd.kd * scale);
            continue; // skip the procedural target
          }
        }
        // Normal arm swing — snappier with pow shaping, slight phase offset from legs
        const armPhaseOffset = 0.3; // arms lag behind legs slightly for natural counter-rotation
        const rawSwing = isMoving ? Math.sin(timeSec * walkFreq + (name.includes("l_") ? 0 : Math.PI) + armPhaseOffset) : 0;
        const shaped = Math.sign(rawSwing) * Math.pow(Math.abs(rawSwing), 0.7);
        const swing = isMoving ? shaped * (isSprinting ? 0.8 : 0.6) : 0.05;
        rev.configureMotorPosition(swing, pd.kp * scale, pd.kd * scale);
      }
    }

    if (name.includes("knee")) {
      const rev = joint as RAPIER.RevoluteImpulseJoint;
      const pd = RAGDOLL_PD.knee;
      const boneName = (name.includes("l_") ? "l_shin" : "r_shin") as BoneName;
      const scale = limbScale(boneName);

      // Check for animation target
      if (ragdoll.hasAnimTargets) {
        const animBone = (name.includes("l_") ? "l_shin" : "r_shin") as BoneName;
        const animQ = ragdoll.animTargetQuaternions.get(animBone);
        if (animQ) {
          const sinHalfAngle = Math.sqrt(animQ.x * animQ.x);
          const angle = 2 * Math.atan2(sinHalfAngle, animQ.w);
          const clampedAngle = Math.max(RAGDOLL_LIMITS.knee.min, Math.min(RAGDOLL_LIMITS.knee.max, angle));
          rev.configureMotorPosition(clampedAngle, pd.kp * scale, pd.kd * scale);
          continue; // skip the procedural target
        }
      }

      if (isMoving) {
        // Asymmetric knee lift: only bend on "lift" half of cycle
        const raw = Math.sin(timeSec * walkFreq + (name.includes("l_") ? Math.PI : 0));
        const liftOnly = Math.max(0, raw);
        const liftAmt = isSprinting ? 0.7 : 0.4;
        const bend = 0.3 + liftOnly * liftAmt;
        rev.configureMotorPosition(bend, pd.kp * scale, pd.kd * scale);
      } else {
        // Idle: slight bend
        rev.configureMotorPosition(0.1, pd.kp * scale, pd.kd * scale);
      }
    }
  }

  // For spherical joints, we can't directly set motor positions in Rapier's
  // spherical joint API (no configureMotorPosition on spherical). Instead, we
  // use impulses on the connected bodies to guide them toward target poses.
  // This is the "force-based" approach for spherical DOF.

  const shoulderPD = RAGDOLL_PD.shoulder;
  const hipPD = RAGDOLL_PD.hip;

  // Shoulder guidance — pull upper arms toward rest position relative to torso
  const torsoBody = ragdoll.bodies.get("torso")!;
  const torsoPos = torsoBody.translation();
  const torsoRot = torsoBody.rotation();

  for (const side of ["l", "r"] as const) {
    const armBone = `${side}_upper_arm` as BoneName;
    const armScale = limbScale(armBone);
    const upperArm = ragdoll.bodies.get(armBone)!;
    const armPos = upperArm.translation();

    // Target: arms hanging at sides with slight outward angle
    const sideSign = side === "l" ? -1 : 1;
    const shoulderOffset = RAGDOLL_TORSO_RADIUS + RAGDOLL_UPPER_ARM_HALF_LENGTH;

    // Compute target arm position in world space (relative to torso)
    const targetLocal = {
      x: sideSign * shoulderOffset,
      y: RAGDOLL_TORSO_HALF_HEIGHT * 0.7 - RAGDOLL_UPPER_ARM_HALF_LENGTH,
      z: isSprinting ? 0.15 : 0, // trail arms behind during sprint
    };

    // Attack pose: push attacking arm forward/back
    const isSideAttacking = attacking && ((side === "l" && atkSide === "left") || (side === "r" && atkSide === "right"));
    if (isSideAttacking) {
      if (ragdoll.attackType === "light") {
        // Jab: push arm forward
        targetLocal.z -= 0.35;
        targetLocal.y += 0.15;
      } else {
        // Heavy swing
        if (ragdoll.attackPhase === "windup") {
          // Pull arm back and to the side
          targetLocal.z += 0.25;
          targetLocal.x += sideSign * 0.1;
        } else if (ragdoll.attackPhase === "strike") {
          // Swing across: arm goes forward and opposite side
          targetLocal.z -= 0.4;
          targetLocal.x -= sideSign * 0.15;
          targetLocal.y += 0.1;
        } else {
          // Follow-through: arm continues past center
          targetLocal.z -= 0.2;
          targetLocal.x -= sideSign * 0.1;
        }
      }
    }

    // Rotate by torso orientation
    const target = rotateByQuat(targetLocal, torsoRot);
    target.x += torsoPos.x;
    target.y += torsoPos.y;
    target.z += torsoPos.z;

    // Override with animation target if available
    if (ragdoll.hasAnimTargets) {
      const animTarget = ragdoll.animTargetPositions.get(armBone);
      if (animTarget) {
        target.x = animTarget.x;
        target.y = animTarget.y;
        target.z = animTarget.z;
      }
    }

    // Spring force toward target
    const dx = target.x - armPos.x;
    const dy = target.y - armPos.y;
    const dz = target.z - armPos.z;

    // Reduce idle arm forces to let arms hang naturally under gravity (prevents vertical bobbing)
    const forceMult = isSideAttacking ? 2.0 : (!isMoving && !isSideAttacking ? 0.5 : 1.0);
    const force = shoulderPD.kp * armScale * 0.01 * forceMult;
    const damp = shoulderPD.kd * armScale * 0.01 * forceMult;
    const vel = upperArm.linvel();

    const armMass = 1.0; // arm collider mass
    const gravCompArm = armMass * 12.0 * 0.016; // lighter compensation for arms (want some sag)
    upperArm.applyImpulse(
      {
        x: dx * force - vel.x * damp,
        y: dy * force - vel.y * damp + gravCompArm,
        z: dz * force - vel.z * damp,
      },
      true,
    );

    // Also push forearm forward during attack for full arm extension
    if (isSideAttacking) {
      const forearmBone = `${side}_lower_arm` as BoneName;
      const forearm = ragdoll.bodies.get(forearmBone)!;
      const forearmPos = forearm.translation();

      const fwdLocal = ragdoll.attackType === "light"
        ? { x: 0, y: 0, z: -0.5 }
        : ragdoll.attackPhase === "strike"
          ? { x: -sideSign * 0.3, y: 0, z: -0.5 }
          : { x: 0, y: 0, z: 0 };

      if (fwdLocal.x !== 0 || fwdLocal.z !== 0) {
        const fwd = rotateByQuat(fwdLocal, torsoRot);
        const fdx = (torsoPos.x + fwd.x) - forearmPos.x;
        const fdy = (torsoPos.y + fwd.y) - forearmPos.y;
        const fdz = (torsoPos.z + fwd.z) - forearmPos.z;
        const fForce = shoulderPD.kp * armScale * 0.008;
        const fVel = forearm.linvel();
        forearm.applyImpulse(
          {
            x: fdx * fForce - fVel.x * damp * 0.5,
            y: fdy * fForce - fVel.y * damp * 0.5,
            z: fdz * fForce - fVel.z * damp * 0.5,
          },
          true,
        );
      }
    }

    // Hip guidance
    const thighBone = `${side}_thigh` as BoneName;
    const thighScale = limbScale(thighBone);
    const thigh = ragdoll.bodies.get(thighBone)!;
    const thighPos = thigh.translation();

    // Idle hip sway: subtle lateral movement when stationary
    const idleSway = !isMoving ? Math.sin(timeSec * 1.2 + (side === "l" ? 0 : Math.PI)) * 0.01 : 0;
    const hipTargetLocal = {
      x: sideSign * 0.12 + idleSway,
      y: -RAGDOLL_TORSO_HALF_HEIGHT - RAGDOLL_THIGH_HALF_LENGTH,
      z: isMoving ? Math.sin(timeSec * walkFreq + (side === "l" ? 0 : Math.PI)) * 0.15 * speed * 0.15 : 0,
    };

    const hipTarget = rotateByQuat(hipTargetLocal, torsoRot);
    hipTarget.x += torsoPos.x;
    hipTarget.y += torsoPos.y;
    hipTarget.z += torsoPos.z;

    if (ragdoll.hasAnimTargets) {
      const animTarget = ragdoll.animTargetPositions.get(thighBone);
      if (animTarget) {
        hipTarget.x = animTarget.x;
        hipTarget.y = animTarget.y;
        hipTarget.z = animTarget.z;
      }
    }

    const hdx = hipTarget.x - thighPos.x;
    const hdy = hipTarget.y - thighPos.y;
    const hdz = hipTarget.z - thighPos.z;

    const hForce = hipPD.kp * thighScale * 0.01;
    const hDamp = hipPD.kd * thighScale * 0.01;
    const hVel = thigh.linvel();

    const thighMass = 1.0;
    const gravCompThigh = thighMass * 13.0 * 0.016;
    thigh.applyImpulse(
      {
        x: hdx * hForce - hVel.x * hDamp,
        y: hdy * hForce - hVel.y * hDamp + gravCompThigh,
        z: hdz * hForce - hVel.z * hDamp,
      },
      true,
    );
  }

  // Head guidance — keep it upright above torso
  const headScale = limbScale("head");
  const headBody = ragdoll.bodies.get("head")!;
  const headPos = headBody.translation();
  const headPD = RAGDOLL_PD.head;

  // Idle breathing: very subtle head bob (reduced to prevent vertical oscillation with low PD gains)
  const breathBob = !isMoving ? Math.sin(timeSec * 1.5) * 0.003 : 0;
  const headTargetLocal = {
    x: 0,
    y: RAGDOLL_TORSO_HALF_HEIGHT + RAGDOLL_HEAD_RADIUS + 0.08 + breathBob,
    z: isSprinting ? -0.06 : 0,
  };
  const headTarget = rotateByQuat(headTargetLocal, torsoRot);
  headTarget.x += torsoPos.x;
  headTarget.y += torsoPos.y;
  headTarget.z += torsoPos.z;

  if (ragdoll.hasAnimTargets) {
    const animTarget = ragdoll.animTargetPositions.get("head");
    if (animTarget) {
      headTarget.x = animTarget.x;
      headTarget.y = animTarget.y;
      headTarget.z = animTarget.z;
    }
  }

  const hhdx = headTarget.x - headPos.x;
  const hhdy = headTarget.y - headPos.y;
  const hhdz = headTarget.z - headPos.z;

  const headForce = headPD.kp * headScale * 0.01;
  const headDamp = headPD.kd * headScale * 0.01;
  const headVel = headBody.linvel();

  // Extra vertical damping on head to suppress bounce oscillation from torso lean
  const headVerticalDamp = headDamp * 2.5;
  // Gravity compensation: counteract most of gravity so PD only handles error correction
  const headMass = 0.5; // head collider mass
  const gravCompHead = headMass * 14.0 * 0.016; // ~93% gravity compensation
  headBody.applyImpulse(
    {
      x: hhdx * headForce - headVel.x * headDamp,
      y: hhdy * headForce - headVel.y * headVerticalDamp + gravCompHead,
      z: hhdz * headForce - headVel.z * headDamp,
    },
    true,
  );
}

// ── Math helpers ──

function yawToQuat(yaw: number): { x: number; y: number; z: number; w: number } {
  const halfYaw = yaw * 0.5;
  return { x: 0, y: Math.sin(halfYaw), z: 0, w: Math.cos(halfYaw) };
}

function composeLeanQuat(yaw: number, pitch: number, roll: number): { x: number; y: number; z: number; w: number } {
  // Compose: Ry(yaw) * Rx(pitch) * Rz(roll)
  const cy = Math.cos(yaw * 0.5), sy = Math.sin(yaw * 0.5);
  const cp = Math.cos(pitch * 0.5), sp = Math.sin(pitch * 0.5);
  const cr = Math.cos(roll * 0.5), sr = Math.sin(roll * 0.5);
  return {
    x: cy * sp * cr + sy * cp * sr,
    y: sy * cp * cr - cy * sp * sr,
    z: cy * cp * sr - sy * sp * cr,
    w: cy * cp * cr + sy * sp * sr,
  };
}

function rotateByQuat(
  v: { x: number; y: number; z: number },
  q: { x: number; y: number; z: number; w: number },
): { x: number; y: number; z: number } {
  // q * v * q^-1 (quaternion rotation of vector)
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;

  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}
