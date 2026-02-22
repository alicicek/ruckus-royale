import {
  DRAG_AIR,
  DRAG_GROUND,
  GRAVITY,
  JUMP_VELOCITY,
  MAX_FALL_SPEED,
  MOVE_SPEED,
  PLAYER_RADIUS,
  SPRINT_MULTIPLIER,
} from "./constants";
import type { ArenaId, InputFrame, Vector3Net } from "./types";

export interface MotionState {
  position: Vector3Net;
  velocity: Vector3Net;
  facingYaw: number;
}

export interface ArenaBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  floorY: number;
  slippery: boolean;
}

const ARENA_BOUNDS: Record<ArenaId, ArenaBounds> = {
  cargo_rooftop: {
    minX: -12,
    maxX: 12,
    minZ: -8,
    maxZ: 8,
    floorY: 0,
    slippery: false,
  },
  ferry_deck: {
    minX: -11,
    maxX: 11,
    minZ: -10,
    maxZ: 10,
    floorY: 0,
    slippery: true,
  },
  factory_pit: {
    minX: -10,
    maxX: 10,
    minZ: -9,
    maxZ: 9,
    floorY: 0,
    slippery: false,
  },
};

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export const lengthSq2 = (x: number, z: number) => x * x + z * z;

export const normalize2 = (x: number, z: number) => {
  const len = Math.hypot(x, z);
  if (len < 1e-6) return { x: 0, z: 0 };
  return { x: x / len, z: z / len };
};

export function arenaBounds(arena: ArenaId): ArenaBounds {
  return ARENA_BOUNDS[arena];
}

export function createSpawnPositions(arena: ArenaId, maxPlayers: number): Vector3Net[] {
  const bounds = arenaBounds(arena);
  const radiusX = Math.max(2.5, (bounds.maxX - bounds.minX) * 0.27);
  const radiusZ = Math.max(2.2, (bounds.maxZ - bounds.minZ) * 0.27);

  const out: Vector3Net[] = [];
  for (let i = 0; i < maxPlayers; i += 1) {
    const angle = (Math.PI * 2 * i) / maxPlayers;
    out.push({
      x: Math.cos(angle) * radiusX,
      y: bounds.floorY + PLAYER_RADIUS,
      z: Math.sin(angle) * radiusZ,
    });
  }
  return out;
}

export function integrateMotion(state: MotionState, input: InputFrame, dt: number, arena: ArenaId): MotionState {
  const bounds = arenaBounds(arena);
  const speedMult = input.sprint ? SPRINT_MULTIPLIER : 1;
  const desired = normalize2(input.moveX, input.moveZ);
  const grounded = state.position.y <= bounds.floorY + PLAYER_RADIUS + 1e-3;

  const targetVX = desired.x * MOVE_SPEED * speedMult;
  const targetVZ = desired.z * MOVE_SPEED * speedMult;
  const drag = grounded ? (bounds.slippery ? DRAG_GROUND * 0.35 : DRAG_GROUND) : DRAG_AIR;

  state.velocity.x += (targetVX - state.velocity.x) * clamp(drag * dt, 0, 1);
  state.velocity.z += (targetVZ - state.velocity.z) * clamp(drag * dt, 0, 1);

  if (grounded && input.jump) {
    state.velocity.y = JUMP_VELOCITY;
  }

  state.velocity.y += GRAVITY * dt;
  if (state.velocity.y < MAX_FALL_SPEED) {
    state.velocity.y = MAX_FALL_SPEED;
  }

  state.position.x += state.velocity.x * dt;
  state.position.y += state.velocity.y * dt;
  state.position.z += state.velocity.z * dt;

  if (state.position.y <= bounds.floorY + PLAYER_RADIUS) {
    state.position.y = bounds.floorY + PLAYER_RADIUS;
    if (state.velocity.y < 0) state.velocity.y = 0;
  }

  if (Math.abs(desired.x) > 0.2 || Math.abs(desired.z) > 0.2) {
    state.facingYaw = Math.atan2(desired.x, desired.z);
  }

  return state;
}

export function edgeDistance(arena: ArenaId, pos: Vector3Net): number {
  const bounds = arenaBounds(arena);
  const xGap = Math.min(pos.x - bounds.minX, bounds.maxX - pos.x);
  const zGap = Math.min(pos.z - bounds.minZ, bounds.maxZ - pos.z);
  return Math.min(xGap, zGap);
}

export function inRingOutZone(arena: ArenaId, pos: Vector3Net): boolean {
  const bounds = arenaBounds(arena);
  if (pos.y < bounds.floorY - 7) return true;
  if (pos.x < bounds.minX - 1.3 || pos.x > bounds.maxX + 1.3) return true;
  if (pos.z < bounds.minZ - 1.3 || pos.z > bounds.maxZ + 1.3) return true;
  return false;
}
