import type { BotDifficulty, HazardStateNet, InputFrame, MatchMode, PlayerStateNet } from "@ruckus/shared";

export type BotMindState = "roam" | "chase" | "recover_edge" | "disengage_hazard" | "opportunistic_grab";

export interface BotMind {
  state: BotMindState;
  decisionTimer: number;
  wanderAngle: number;
  targetId: string | null;
}

export interface InternalPlayerState extends PlayerStateNet {
  isReady: boolean;
  rematchVote: boolean;
  connected: boolean;
  latestInput: InputFrame;
  queuedSpawn: boolean;
  spawnDelay: number;
  botDifficulty?: BotDifficulty;
  botMind?: BotMind;
}

export interface InternalHazard extends HazardStateNet {
  basePositionX: number;
  basePositionZ: number;
  amplitude: number;
  speed: number;
  axis: "x" | "z";
  phase: number;
  cycle: number;
  cooldown: number;
}

export interface SimulationConfig {
  mode: MatchMode;
  roomCode: string;
  onRoundEvent: (event: {
    type: string;
    actorId?: string;
    targetId?: string;
    atTick: number;
    message?: string;
  }) => void;
}
