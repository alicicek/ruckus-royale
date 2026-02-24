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
export const GRAVITY = -35;
export const MOVE_SPEED = 5.5;
export const SPRINT_MULTIPLIER = 1.45;
export const JUMP_VELOCITY = 8.5;
export const DRAG_GROUND = 6;
export const DRAG_AIR = 1.2;
export const MAX_FALL_SPEED = -24;
export const EXTRA_GRAVITY_FALLING = 1.6;
export const TURN_SPEED_RAD = 8.0;

export const LIGHT_ATTACK_RANGE = 1.5;
export const HEAVY_ATTACK_RANGE = 1.8;
export const GRAB_RANGE = 1.4;

export const LIGHT_ATTACK_COOLDOWN = 0.45;
export const HEAVY_ATTACK_COOLDOWN = 0.95;
export const GRAB_COOLDOWN = 0.35;

export const ATTACK_IMPULSE_LIGHT = 8.0;
export const ATTACK_IMPULSE_HEAVY = 14.0;

export const LIGHT_STUN_DAMAGE = 14;
export const HEAVY_STUN_DAMAGE = 32;
export const HAZARD_STUN_DAMAGE = 45;
export const STUN_KNOCKOUT_THRESHOLD = 300;
export const STUN_DECAY_RATE = 4;

export const EDGE_RECOVERY_BOOST = 9;

export const INTERPOLATION_DELAY_MS = 100;
export const LATE_INPUT_WINDOW_MS = 250;

export const BOT_BASE_REACTION_SECONDS = {
  easy: 0.35,
  normal: 0.22,
  hard: 0.14,
  dummy: 999,
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
  head:     { kp: 120,  kd: 15  },
  shoulder: { kp: 15,   kd: 3   },
  elbow:    { kp: 8,    kd: 2   },
  hip:      { kp: 80,   kd: 12  },
  knee:     { kp: 50,   kd: 8   },
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
export const RAGDOLL_GRAB_STIFFNESS = 200;           // spring stiffness for grab joint
export const RAGDOLL_GRAB_DAMPING = 20;              // spring damping for grab joint
export const RAGDOLL_THROW_IMPULSE = 22;             // impulse magnitude on throw
export const RAGDOLL_THROW_UPWARD = 8;               // upward component of throw impulse
export const RAGDOLL_GRAB_STIFFNESS_DROP = 0.25;     // target stiffness while grabbed (ragdolly)

// ── Hit impulse tuning ──
export const RAGDOLL_LIGHT_HIT_IMPULSE = {
  directional: 0.4,     // multiplier for horizontal push
  upward: 0.1,          // bonus upward component
  stiffnessDrop: 0.2,   // stiffness during light hit reaction
  duration: 0.35,       // seconds of hit reaction
};
export const RAGDOLL_HEAVY_HIT_IMPULSE = {
  directional: 0.7,     // bigger push
  upward: 0.2,          // more loft
  stiffnessDrop: 0.08,  // more dramatic wobble
  duration: 0.55,       // longer reaction
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

export const RAGDOLL_MAX_STIFFNESS_ACTIVE = 0.75;
export const RAGDOLL_LIMB_MAX_STIFFNESS: Record<string, number> = {
  torso: 1.0,
  head: 0.8,
  l_upper_arm: 0.3, r_upper_arm: 0.3,
  l_lower_arm: 0.2, r_lower_arm: 0.2,
  l_thigh: 0.7, r_thigh: 0.7,
  l_shin: 0.65, r_shin: 0.65,
};

// ── Torso lean + idle sway (Gang Beasts "balancing on a ball" feel) ──
export const LEAN_ACCELERATION_FACTOR = 0.012;
export const LEAN_MAX_PITCH = 0.18;
export const LEAN_MAX_ROLL = 0.14;
export const LEAN_DECAY_RATE = 4.0;
export const LEAN_LANDING_IMPULSE = 0.25;
export const IDLE_SWAY_AMPLITUDE = 0.04;
export const IDLE_SWAY_FREQUENCY = 0.8;

// ── Ragdoll contact skin (improves physics stability by keeping colliders slightly apart) ──
export const RAGDOLL_CONTACT_SKIN = 0.02;

// ── Quaternion PD torque tuning (for spherical joints: neck, shoulder, hip) ──
export const QUAT_PD = {
  neck:     { kp: 0.8, kd: 0.15, maxTorque: 2.0 },   // low kp, high kd, tight limits
  shoulder: { kp: 0.3, kd: 0.06, maxTorque: 1.5 },   // medium kp, medium kd
  hip:      { kp: 1.2, kd: 0.2,  maxTorque: 3.0 },   // stronger for stability
};

// ── Network correction smoothing ──
export const RAGDOLL_CORRECTION_SMOOTH_RATE = 10.0; // exponential smoothing rate for medium corrections

// ── Blob puppet proportions (physics-first, Gang Beasts style) ──
export const BLOB_TORSO_HALF_HEIGHT = 0.30;
export const BLOB_TORSO_RADIUS = 0.38;
export const BLOB_HEAD_RADIUS = 0.22;
export const BLOB_UPPER_ARM_HALF_LENGTH = 0.16;
export const BLOB_LOWER_ARM_HALF_LENGTH = 0.14;
export const BLOB_THIGH_HALF_LENGTH = 0.18;
export const BLOB_SHIN_HALF_LENGTH = 0.18;
export const BLOB_LIMB_RADIUS = 0.12;

// ── Visual mode toggle ──
export const USE_BLOB_VISUALS = true; // toggle between blob primitives and GLTF characters
export const USE_BEAN_MESH = false;   // when true AND bean GLB exists, use it instead of blob primitives

// ── Upright controller (scales lean limits by stiffness for drunk-but-controllable feel) ──
export const UPRIGHT_KP = 5.0;
export const UPRIGHT_KD = 1.5;
export const UPRIGHT_MAX_LEAN = 0.35;    // max lean angle (radians) when at full stiffness
export const UPRIGHT_FLOPPY_LEAN = 1.2;  // max lean angle (radians) when knocked out (stiffness=0)

// ── Distance-based walk phase ──
export const WALK_PHASE_RATE = 4.5;            // radians of phase per unit distance traveled
export const STUMBLE_PHASE_AMPLITUDE = 0.6;    // max random phase perturbation when stiffness is low
export const STUMBLE_PHASE_FREQUENCY = 2.5;    // how fast stumble noise oscillates (Hz)
export const SPRINT_SWING_MULTIPLIER = 1.5;    // exaggeration factor for arm/leg swing during sprint
export const SPRINT_KNEE_LIFT = 0.7;           // knee lift amount during sprint
export const WALK_KNEE_LIFT = 0.4;             // knee lift amount during walk
