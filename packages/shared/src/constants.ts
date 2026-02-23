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

// ── Ragdoll body dimensions (chunky party-brawler proportions) ──
export const RAGDOLL_TORSO_HALF_HEIGHT = 0.35;
export const RAGDOLL_TORSO_RADIUS = 0.32;
export const RAGDOLL_HEAD_RADIUS = 0.26;
export const RAGDOLL_UPPER_ARM_HALF_LENGTH = 0.2;
export const RAGDOLL_LOWER_ARM_HALF_LENGTH = 0.18;
export const RAGDOLL_THIGH_HALF_LENGTH = 0.22;
export const RAGDOLL_SHIN_HALF_LENGTH = 0.22;
export const RAGDOLL_LIMB_RADIUS = 0.1;

// ── Ragdoll PD motor tuning (stiffness Kp, damping Kd) ──
export const RAGDOLL_PD = {
  head:     { kp: 800,  kd: 80  },
  shoulder: { kp: 400,  kd: 40  },
  elbow:    { kp: 200,  kd: 20  },
  hip:      { kp: 600,  kd: 60  },
  knee:     { kp: 300,  kd: 30  },
} as const;

// ── Ragdoll joint limits (radians) ──
export const RAGDOLL_LIMITS = {
  head_pitch:  { min: -0.5, max: 0.5 },
  shoulder:    { min: -2.1, max: 2.1 },
  elbow:       { min: 0,    max: 2.5 },
  hip:         { min: -1.6, max: 1.6 },
  knee:        { min: 0,    max: 2.6 },
} as const;

// ── Ragdoll collision groups ──
// Membership bits: bit 0 = environment, bits 1-15 = ragdoll groups
export const COLLISION_GROUP_ENVIRONMENT = 0x0001;

// ── Ragdoll combat ──
export const RAGDOLL_HIT_STIFFNESS_DROP = 0.25;     // multiplier on stiffness during hit reaction
export const RAGDOLL_HIT_RECOVERY_RATE = 2.5;       // stiffness recovery per second (0→1 in ~0.4s)
export const RAGDOLL_KNOCKOUT_RECOVERY_TIME = 1.2;   // seconds to stay fully limp before recovery begins
export const RAGDOLL_GRAB_BREAK_FORCE = 800;         // newtons before grab joint breaks
export const RAGDOLL_GRAB_STIFFNESS = 600;           // spring stiffness for grab joint
export const RAGDOLL_GRAB_DAMPING = 60;              // spring damping for grab joint
export const RAGDOLL_THROW_IMPULSE = 12;             // impulse magnitude on throw
export const RAGDOLL_THROW_UPWARD = 4;               // upward component of throw impulse
export const RAGDOLL_GRAB_STIFFNESS_DROP = 0.5;      // target stiffness while grabbed (ragdolly)

// ── Hit impulse tuning ──
export const RAGDOLL_LIGHT_HIT_IMPULSE = {
  directional: 0.25,    // multiplier for horizontal push
  upward: 0.1,          // bonus upward component
  stiffnessDrop: 0.35,  // stiffness during light hit reaction
  duration: 0.25,       // seconds of hit reaction
};
export const RAGDOLL_HEAVY_HIT_IMPULSE = {
  directional: 0.45,    // bigger push
  upward: 0.2,          // more loft
  stiffnessDrop: 0.15,  // more dramatic wobble
  duration: 0.4,        // longer reaction
};

// ── Per-limb recovery order (lower = recovers first) ──
// Torso recovers first (most important for standing), arms last (floppy longest)
export const RAGDOLL_LIMB_RECOVERY_ORDER: Record<string, number> = {
  torso: 0.0,
  head: 0.1,
  l_thigh: 0.2,
  r_thigh: 0.2,
  l_shin: 0.3,
  r_shin: 0.3,
  l_upper_arm: 0.5,
  r_upper_arm: 0.5,
  l_lower_arm: 0.7,
  r_lower_arm: 0.7,
};
