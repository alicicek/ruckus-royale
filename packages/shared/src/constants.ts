export const ROOM_NAME = "brawl_room";

export const MAX_PLAYERS = 8;
export const SERVER_TICK_RATE = 60;
export const SERVER_TICK_DT = 1 / SERVER_TICK_RATE;
export const SNAPSHOT_RATE = 20;

export const ROUND_DURATION_SECONDS = 90;
export const SUDDEN_DEATH_SECONDS = 60;
export const BEST_OF_ROUNDS = 5;
export const WINS_TO_WIN_MATCH = 3;

export const PLAYER_RADIUS = 0.45;
export const PLAYER_HEIGHT = 1.6;
export const GRAVITY = -28;
export const MOVE_SPEED = 7;
export const SPRINT_MULTIPLIER = 1.35;
export const JUMP_VELOCITY = 10;
export const DRAG_GROUND = 10;
export const DRAG_AIR = 1.8;
export const MAX_FALL_SPEED = -24;

export const LIGHT_ATTACK_RANGE = 1.5;
export const HEAVY_ATTACK_RANGE = 1.8;
export const GRAB_RANGE = 1.4;

export const LIGHT_ATTACK_COOLDOWN = 0.45;
export const HEAVY_ATTACK_COOLDOWN = 0.95;
export const GRAB_COOLDOWN = 0.35;

export const ATTACK_IMPULSE_LIGHT = 6.2;
export const ATTACK_IMPULSE_HEAVY = 9.3;

export const LIGHT_STUN_DAMAGE = 14;
export const HEAVY_STUN_DAMAGE = 32;
export const HAZARD_STUN_DAMAGE = 45;
export const STUN_KNOCKOUT_THRESHOLD = 100;
export const STUN_DECAY_RATE = 4;

export const COLLISION_BOUNCE = 3.5;

export const EDGE_RECOVERY_BOOST = 9;

export const INTERPOLATION_DELAY_MS = 100;
export const LATE_INPUT_WINDOW_MS = 250;

export const BOT_BASE_REACTION_SECONDS = {
  easy: 0.35,
  normal: 0.22,
  hard: 0.14,
} as const;

export const ARENAS = ["cargo_rooftop", "ferry_deck", "factory_pit"] as const;
