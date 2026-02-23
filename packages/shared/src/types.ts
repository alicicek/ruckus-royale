import { ARENAS } from "./constants";

export type ArenaId = (typeof ARENAS)[number];

export type MatchMode = "online" | "solo" | "practice";
export type BotDifficulty = "easy" | "normal" | "hard" | "dummy";

export interface Vector3Net {
  x: number;
  y: number;
  z: number;
}

export interface InputFrame {
  tick: number;
  moveX: number;
  moveZ: number;
  jump: boolean;
  grab: boolean;
  lightAttack: boolean;
  heavyAttack: boolean;
  sprint: boolean;
  emote: boolean;
}

export type PlayerRole = "human" | "bot";

/** Ragdoll visual hints for remote client ragdoll approximation */
export interface RagdollHintNet {
  /** 0 = full ragdoll, 1 = full control */
  stiffness: number;
  /** Current ragdoll state */
  state: "active" | "hit" | "knockout" | "recovering";
  /** Direction of last hit (normalized, for remote ragdoll deformation) */
  hitDirX: number;
  hitDirZ: number;
}

export interface PlayerStateNet {
  id: string;
  name: string;
  role: PlayerRole;
  alive: boolean;
  knockedOut: boolean;
  position: Vector3Net;
  velocity: Vector3Net;
  facingYaw: number;
  stun: number;
  grabbedTargetId: string | null;
  grabbedById: string | null;
  lastInputTick: number;
  attackCooldownLight: number;
  attackCooldownHeavy: number;
  grabCooldown: number;
  emoteTimer: number;
  knockouts: number;
  wins: number;
  /** Ragdoll visual hints for remote players */
  ragdollHint?: RagdollHintNet;
}

export interface HazardStateNet {
  id: string;
  kind: "moving_crate" | "sweeper" | "conveyor" | "press";
  position: Vector3Net;
  velocity: Vector3Net;
  radius: number;
  active: boolean;
}

export interface PickupStateNet {
  id: string;
  kind: "energy" | "shield";
  position: Vector3Net;
  active: boolean;
}

export type RoundPhase = "lobby" | "countdown" | "active" | "between_rounds" | "match_over";

export interface RoundStateNet {
  phase: RoundPhase;
  mode: MatchMode;
  arena: ArenaId;
  roundNumber: number;
  maxRounds: number;
  roundTimeLeft: number;
  suddenDeath: boolean;
  readyCount: number;
  targetReadyCount: number;
  survivors: string[];
  scoreboard: Record<string, number>;
  roundWinnerId: string | null;
  matchWinnerId: string | null;
}

export interface SnapshotNet {
  serverTick: number;
  roundState: RoundStateNet;
  players: PlayerStateNet[];
  hazards: HazardStateNet[];
  pickups: PickupStateNet[];
}

export interface JoinRoomPayload {
  roomCode?: string;
  playerName: string;
  mode: MatchMode;
  botDifficulty?: BotDifficulty;
}

export interface ReadyStatePayload {
  ready: boolean;
}

export interface RematchVotePayload {
  vote: boolean;
}

export type RoundEventType =
  | "round_start"
  | "round_end"
  | "match_end"
  | "knockout"
  | "grab"
  | "release"
  | "hit"
  | "hazard_hit";

export interface RoundEvent {
  type: RoundEventType;
  actorId?: string;
  targetId?: string;
  atTick: number;
  message?: string;
}

/** Debug / text-mode render payload used by the client for terminal rendering. */
export interface RenderTextPayload {
  coordinateSystem: {
    origin: string;
    xAxis: string;
    yAxis: string;
    zAxis: string;
  };
  mode: MatchMode;
  roomCode: string;
  localPlayerId: string | null;
  round: RoundStateNet;
  players: Array<{
    id: string;
    name: string;
    alive: boolean;
    role: PlayerRole;
    position: Vector3Net;
    velocity: Vector3Net;
    stun: number;
    wins: number;
  }>;
  hazards: HazardStateNet[];
}
