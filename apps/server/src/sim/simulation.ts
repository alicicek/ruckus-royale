import {
  ARENAS,
  BEST_OF_ROUNDS,
  EDGE_RECOVERY_BOOST,
  GRAB_COOLDOWN,
  GRAB_RANGE,
  HAZARD_STUN_DAMAGE,
  HEAVY_ATTACK_COOLDOWN,
  HEAVY_ATTACK_RANGE,
  HEAVY_STUN_DAMAGE,
  ATTACK_IMPULSE_HEAVY,
  ATTACK_IMPULSE_LIGHT,
  LATE_INPUT_WINDOW_MS,
  LIGHT_ATTACK_COOLDOWN,
  LIGHT_ATTACK_RANGE,
  LIGHT_STUN_DAMAGE,
  MAX_PLAYERS,
  PLAYER_RADIUS,
  ROUND_DURATION_SECONDS,
  SERVER_TICK_RATE,
  STUN_KNOCKOUT_THRESHOLD,
  SUDDEN_DEATH_SECONDS,
  WINS_TO_WIN_MATCH,
  arenaBounds,
  clamp,
  createSpawnPositions,
  edgeDistance,
  inRingOutZone,
  integrateMotion,
  normalize2,
  type ArenaId,
  type BotDifficulty,
  type HazardStateNet,
  type InputFrame,
  type MatchMode,
  type PickupStateNet,
  type PlayerStateNet,
  type RoundStateNet,
  type SnapshotNet,
  type Vector3Net,
} from "@ruckus/shared";
import { buildBotInput } from "../bots/botController";
import type { InternalHazard, InternalPlayerState, SimulationConfig } from "./types";

const EMPTY_INPUT: InputFrame = {
  tick: 0,
  moveX: 0,
  moveZ: 0,
  jump: false,
  grab: false,
  lightAttack: false,
  heavyAttack: false,
  sprint: false,
  emote: false,
};

const SOLO_INITIAL_ACTIVE_BOTS = 2;
const SOLO_MAX_ACTIVE_BOTS = 2;
const SOLO_BOT_CAP_RAMP_SECONDS = 18;
const SOLO_BOT_SPAWN_INTERVAL_SECONDS = 10;
const SOLO_GRACE_SECONDS = 8;
const SOLO_BOT_SPEED_RAMP_SECONDS = 40;
const SOLO_EDGE_PROTECTION_SECONDS = 32;
const SOLO_MIN_ROUND_SECONDS = 30;

function randomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 5; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function fallbackName(prefix: string, index: number): string {
  return `${prefix}-${index}`;
}

function createPlayer(id: string, name: string, role: "human" | "bot"): InternalPlayerState {
  return {
    id,
    name,
    role,
    alive: true,
    position: { x: 0, y: PLAYER_RADIUS, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    facingYaw: 0,
    stun: 0,
    grabbedTargetId: null,
    grabbedById: null,
    lastInputTick: 0,
    attackCooldownLight: 0,
    attackCooldownHeavy: 0,
    grabCooldown: 0,
    emoteTimer: 0,
    knockouts: 0,
    wins: 0,
    isReady: false,
    rematchVote: false,
    connected: role === "bot",
    latestInput: { ...EMPTY_INPUT },
    queuedSpawn: false,
    spawnDelay: 0,
    ragdollStiffness: 1,
    ragdollState: "active",
    lastHitDirX: 0,
    lastHitDirZ: 0,
    ragdollRecoveryTimer: 0,
  };
}

export class BrawlSimulation {
  public readonly mode: MatchMode;
  public readonly roomCode: string;

  public serverTick = 0;

  private readonly onRoundEvent: SimulationConfig["onRoundEvent"];
  private readonly players = new Map<string, InternalPlayerState>();
  private readonly humanIds = new Set<string>();
  private hazards: InternalHazard[] = [];
  private pickups: PickupStateNet[] = [];

  private roundState: RoundStateNet;
  private arena: ArenaId = ARENAS[0];
  private roundTimer = 0;
  private betweenRoundTimer = 0;
  private countdownTimer = 0;
  private spawnPositions: Vector3Net[] = [];
  private spawnCursor = 0;

  constructor(config: SimulationConfig) {
    this.mode = config.mode;
    this.roomCode = config.roomCode || randomCode();
    this.onRoundEvent = config.onRoundEvent;

    this.roundState = {
      phase: "lobby",
      mode: this.mode,
      arena: this.arena,
      roundNumber: 0,
      maxRounds: BEST_OF_ROUNDS,
      roundTimeLeft: 0,
      suddenDeath: false,
      readyCount: 0,
      targetReadyCount: 0,
      survivors: [],
      scoreboard: {},
      roundWinnerId: null,
      matchWinnerId: null,
    };
  }

  getStateSnapshot(): SnapshotNet {
    return {
      serverTick: this.serverTick,
      roundState: {
        ...this.roundState,
        scoreboard: { ...this.roundState.scoreboard },
        survivors: [...this.roundState.survivors],
      },
      players: [...this.players.values()].map((p): PlayerStateNet => ({
        id: p.id,
        name: p.name,
        role: p.role,
        alive: p.alive,
        position: { ...p.position },
        velocity: { ...p.velocity },
        facingYaw: p.facingYaw,
        stun: p.stun,
        grabbedTargetId: p.grabbedTargetId,
        grabbedById: p.grabbedById,
        lastInputTick: p.lastInputTick,
        attackCooldownLight: p.attackCooldownLight,
        attackCooldownHeavy: p.attackCooldownHeavy,
        grabCooldown: p.grabCooldown,
        emoteTimer: p.emoteTimer,
        knockouts: p.knockouts,
        wins: p.wins,
        ragdollHint: {
          stiffness: p.ragdollStiffness,
          state: p.ragdollState === "hit" ? "hit"
            : p.ragdollState === "knockout" ? "knockout"
            : p.ragdollState === "recovering" ? "recovering"
            : "active",
          hitDirX: p.lastHitDirX,
          hitDirZ: p.lastHitDirZ,
        },
      })),
      hazards: this.hazards.map((hazard) => ({
        id: hazard.id,
        kind: hazard.kind,
        position: { ...hazard.position },
        velocity: { ...hazard.velocity },
        radius: hazard.radius,
        active: hazard.active,
      })),
      pickups: this.pickups.map((pickup) => ({ ...pickup, position: { ...pickup.position } })),
    };
  }

  getPlayerCount(): number {
    return this.players.size;
  }

  getHumanCount(): number {
    return this.humanIds.size;
  }

  addHumanPlayer(playerId: string, displayName: string): void {
    const existing = this.players.get(playerId);
    if (existing) {
      existing.connected = true;
      existing.name = displayName;
      existing.lastInputTick = this.serverTick;
      return;
    }

    const player = createPlayer(playerId, displayName, "human");
    player.connected = true;
    player.isReady = this.mode === "solo" || this.mode === "practice";
    this.players.set(playerId, player);
    this.humanIds.add(playerId);

    if (this.roundState.scoreboard[playerId] == null) {
      this.roundState.scoreboard[playerId] = 0;
    }

    if (this.mode === "solo") {
      this.ensureSoloBots();
    }
  }

  removeHumanPlayer(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) return;

    this.releaseGrab(playerId);

    if (player.grabbedById) {
      const grabber = this.players.get(player.grabbedById);
      if (grabber) grabber.grabbedTargetId = null;
      player.grabbedById = null;
    }

    this.players.delete(playerId);
    this.humanIds.delete(playerId);
    delete this.roundState.scoreboard[playerId];

    if (this.roundState.matchWinnerId === playerId) {
      this.roundState.matchWinnerId = null;
    }

    if (this.roundState.roundWinnerId === playerId) {
      this.roundState.roundWinnerId = null;
    }

    if (this.mode === "solo") {
      this.ensureSoloBots();
    }
  }

  setReady(playerId: string, ready: boolean): void {
    const player = this.players.get(playerId);
    if (!player || player.role !== "human") return;
    player.isReady = ready;
  }

  setRematchVote(playerId: string, vote: boolean): void {
    const player = this.players.get(playerId);
    if (!player || player.role !== "human") return;
    player.rematchVote = vote;
  }

  applyInput(playerId: string, input: InputFrame): void {
    const player = this.players.get(playerId);
    if (!player || player.role !== "human") return;
    if (this.roundState.phase !== "active") return;
    if (input.tick <= player.lastInputTick) return;

    const lateWindowTicks = Math.floor((LATE_INPUT_WINDOW_MS / 1000) * SERVER_TICK_RATE);
    if (input.tick < this.serverTick - lateWindowTicks) return;

    player.latestInput = {
      tick: input.tick,
      moveX: clamp(input.moveX, -1, 1),
      moveZ: clamp(input.moveZ, -1, 1),
      jump: Boolean(input.jump),
      grab: Boolean(input.grab),
      lightAttack: Boolean(input.lightAttack),
      heavyAttack: Boolean(input.heavyAttack),
      sprint: Boolean(input.sprint),
      emote: Boolean(input.emote),
    };
    player.lastInputTick = input.tick;
  }

  step(dt: number): void {
    this.serverTick += 1;

    this.roundState.targetReadyCount = this.humanIds.size;
    this.roundState.readyCount = [...this.humanIds].filter((id) => this.players.get(id)?.isReady).length;

    for (const player of this.players.values()) {
      player.attackCooldownLight = Math.max(0, player.attackCooldownLight - dt);
      player.attackCooldownHeavy = Math.max(0, player.attackCooldownHeavy - dt);
      player.grabCooldown = Math.max(0, player.grabCooldown - dt);
      player.emoteTimer = Math.max(0, player.emoteTimer - dt);
      player.stun = Math.max(0, player.stun - dt * 8.5);

      // Update ragdoll hint state machine
      if (player.ragdollRecoveryTimer > 0) {
        player.ragdollRecoveryTimer -= dt;
        if (player.ragdollRecoveryTimer <= 0) {
          player.ragdollState = "recovering";
        }
      }
      if (player.ragdollState === "recovering") {
        player.ragdollStiffness = Math.min(1, player.ragdollStiffness + 2.5 * dt);
        if (player.ragdollStiffness >= 0.99) {
          player.ragdollStiffness = 1;
          player.ragdollState = "active";
        }
      }
      if (player.ragdollState === "active" && player.stun > 0) {
        player.ragdollStiffness = 1 - Math.min(0.5, player.stun * 0.005);
      }
    }

    switch (this.roundState.phase) {
      case "lobby":
        this.handleLobby(dt);
        break;
      case "countdown":
        this.handleCountdown(dt);
        break;
      case "active":
        this.handleActiveRound(dt);
        break;
      case "between_rounds":
        this.handleBetweenRounds(dt);
        break;
      case "match_over":
        this.handleMatchOver(dt);
        break;
    }
  }

  private handleLobby(_dt: number): void {
    if (this.roundState.targetReadyCount === 0) return;

    if (this.roundState.readyCount >= this.roundState.targetReadyCount) {
      this.roundState.phase = "countdown";
      this.countdownTimer = 3;
      this.roundState.roundTimeLeft = this.countdownTimer;
    }
  }

  private handleCountdown(dt: number): void {
    this.countdownTimer -= dt;
    this.roundState.roundTimeLeft = Math.max(0, this.countdownTimer);
    if (this.countdownTimer <= 0) {
      this.startRound();
    }
  }

  private handleBetweenRounds(dt: number): void {
    this.betweenRoundTimer -= dt;
    this.roundState.roundTimeLeft = Math.max(0, this.betweenRoundTimer);
    if (this.betweenRoundTimer <= 0) {
      this.startRound();
    }
  }

  private handleMatchOver(_dt: number): void {
    const humanIds = [...this.humanIds];
    if (humanIds.length === 0) return;

    const allVoted = humanIds.every((id) => this.players.get(id)?.rematchVote);
    if (allVoted) {
      this.resetForRematch();
      this.roundState.phase = "countdown";
      this.countdownTimer = 3;
      this.roundState.roundTimeLeft = this.countdownTimer;
    }
  }

  private handleActiveRound(dt: number): void {
    this.roundTimer += dt;
    if (this.mode === "practice") {
      this.roundState.roundTimeLeft = ROUND_DURATION_SECONDS;
      this.roundState.suddenDeath = false;
    } else {
      this.roundState.roundTimeLeft = Math.max(0, ROUND_DURATION_SECONDS - this.roundTimer);
      this.roundState.suddenDeath = this.roundTimer >= SUDDEN_DEATH_SECONDS;
    }

    this.updateSoloBotSpawns(dt);
    this.updateBotInputs(dt);

    for (const player of this.players.values()) {
      if (!player.alive) continue;

      if (player.grabbedById) {
        const grabber = this.players.get(player.grabbedById);
        if (!grabber || !grabber.alive) {
          player.grabbedById = null;
        }
      }

      if (player.grabbedById) {
        continue;
      }

      const input = player.latestInput;

      const motionState = {
        position: player.position,
        velocity: player.velocity,
        facingYaw: player.facingYaw,
      };
      integrateMotion(motionState, input, dt, this.arena);
      player.facingYaw = motionState.facingYaw;

      if (this.isGraceProtectedHuman(player)) {
        const bounds = arenaBounds(this.arena);
        player.position.x = clamp(player.position.x, bounds.minX + 2.2, bounds.maxX - 2.2);
        player.position.z = clamp(player.position.z, bounds.minZ + 2.2, bounds.maxZ - 2.2);
      }

      if (input.emote) {
        player.emoteTimer = 0.8;
      }

      if (input.grab) {
        if (player.grabbedTargetId) {
          this.releaseGrab(player.id);
        } else if (player.grabCooldown <= 0) {
          this.tryGrab(player);
        }
      }

      if (input.lightAttack && player.attackCooldownLight <= 0) {
        this.performAttack(player, "light");
      }

      if (input.heavyAttack && player.attackCooldownHeavy <= 0) {
        this.performAttack(player, "heavy");
      }

      if (input.jump && edgeDistance(this.arena, player.position) < 1) {
        const bounds = arenaBounds(this.arena);
        const distLeft = player.position.x - bounds.minX;
        const distRight = bounds.maxX - player.position.x;
        const distBottom = player.position.z - bounds.minZ;
        const distTop = bounds.maxZ - player.position.z;
        const minDist = Math.min(distLeft, distRight, distBottom, distTop);

        let pushX = 0;
        let pushZ = 0;
        if (minDist === distLeft) pushX = 1;
        else if (minDist === distRight) pushX = -1;
        else if (minDist === distBottom) pushZ = 1;
        else pushZ = -1;

        player.velocity.x += pushX * EDGE_RECOVERY_BOOST * dt;
        player.velocity.z += pushZ * EDGE_RECOVERY_BOOST * dt;
      }

      if (player.stun >= STUN_KNOCKOUT_THRESHOLD) {
        this.knockout(player.id, "stun-overload");
      }
    }

    this.resolveGrabbedTargets();
    this.resolvePlayerCollisions();
    this.updateHazards(dt);
    this.applyHazards(dt);

    for (const player of this.players.values()) {
      if (!player.alive) continue;
      if (this.isEdgeProtectedHuman(player)) {
        const bounds = arenaBounds(this.arena);
        player.position.x = clamp(player.position.x, bounds.minX + 0.9, bounds.maxX - 0.9);
        player.position.z = clamp(player.position.z, bounds.minZ + 0.9, bounds.maxZ - 0.9);
        player.position.y = Math.max(player.position.y, bounds.floorY + PLAYER_RADIUS);
        if (player.velocity.y < 0) player.velocity.y = 0;
        continue;
      }
      if (inRingOutZone(this.arena, player.position)) {
        this.knockout(player.id, "ring-out");
      }
    }

    this.roundState.survivors = [...this.players.values()].filter((player) => player.alive).map((player) => player.id);

    if (this.shouldFinishRound()) {
      this.finishRound();
    }
  }

  private updateBotInputs(dt: number): void {
    const players = [...this.players.values()];
    const soloAggression = this.soloBotAggressionScale();

    for (const player of players) {
      if (player.role !== "bot") continue;
      if (!player.alive) {
        player.latestInput = { ...EMPTY_INPUT, tick: this.serverTick };
        player.lastInputTick = this.serverTick;
        continue;
      }

      const input = buildBotInput({
        tick: this.serverTick,
        dt,
        arena: this.arena,
        bot: player,
        players,
        hazards: this.hazards,
      });

      if (this.mode === "solo") {
        input.moveX *= soloAggression;
        input.moveZ *= soloAggression;
        input.sprint = input.sprint && soloAggression > 0.72;
        input.lightAttack = input.lightAttack && Math.random() < soloAggression;
        input.heavyAttack = input.heavyAttack && Math.random() < soloAggression * 0.6;
        input.grab = input.grab && Math.random() < soloAggression * 0.8;
      }

      player.latestInput = input;
      player.lastInputTick = input.tick;
    }
  }

  private tryGrab(player: InternalPlayerState): void {
    const forwardX = Math.sin(player.facingYaw);
    const forwardZ = Math.cos(player.facingYaw);
    let best: InternalPlayerState | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const candidate of this.players.values()) {
      if (!candidate.alive || candidate.id === player.id || candidate.grabbedById) continue;
      if (this.mode === "solo" && player.role === "bot" && candidate.role === "human" && this.roundTimer < 20) continue;
      const dx = candidate.position.x - player.position.x;
      const dz = candidate.position.z - player.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > GRAB_RANGE) continue;

      const align = (dx * forwardX + dz * forwardZ) / Math.max(0.001, dist);
      if (align < -0.2) continue;

      const score = dist - align * 0.4;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    player.grabCooldown = GRAB_COOLDOWN;
    if (!best) return;

    player.grabbedTargetId = best.id;
    best.grabbedById = player.id;
    best.velocity.x = 0;
    best.velocity.z = 0;

    this.onRoundEvent({
      type: "grab",
      actorId: player.id,
      targetId: best.id,
      atTick: this.serverTick,
    });
  }

  private releaseGrab(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player || !player.grabbedTargetId) return;

    const target = this.players.get(player.grabbedTargetId);
    if (target) target.grabbedById = null;

    this.onRoundEvent({
      type: "release",
      actorId: player.id,
      targetId: player.grabbedTargetId,
      atTick: this.serverTick,
    });

    player.grabbedTargetId = null;
  }

  private resolveGrabbedTargets(): void {
    for (const player of this.players.values()) {
      if (!player.alive || !player.grabbedTargetId) continue;
      const target = this.players.get(player.grabbedTargetId);
      if (!target || !target.alive) {
        player.grabbedTargetId = null;
        continue;
      }

      const offset = 0.95;
      const fx = Math.sin(player.facingYaw);
      const fz = Math.cos(player.facingYaw);

      target.position.x = player.position.x + fx * offset;
      target.position.y = Math.max(player.position.y + 0.1, PLAYER_RADIUS);
      target.position.z = player.position.z + fz * offset;
      target.velocity.x = player.velocity.x;
      target.velocity.y = player.velocity.y;
      target.velocity.z = player.velocity.z;

      const dx = target.position.x - player.position.x;
      const dz = target.position.z - player.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 2.1) {
        this.releaseGrab(player.id);
      }
    }
  }

  private performAttack(attacker: InternalPlayerState, kind: "light" | "heavy"): void {
    const isHeavy = kind === "heavy";
    const range = isHeavy ? HEAVY_ATTACK_RANGE : LIGHT_ATTACK_RANGE;
    const damage = isHeavy ? HEAVY_STUN_DAMAGE : LIGHT_STUN_DAMAGE;
    const impulse = isHeavy ? ATTACK_IMPULSE_HEAVY : ATTACK_IMPULSE_LIGHT;

    const fx = Math.sin(attacker.facingYaw);
    const fz = Math.cos(attacker.facingYaw);

    for (const target of this.players.values()) {
      if (!target.alive || target.id === attacker.id) continue;
      if (this.mode === "solo" && attacker.role === "bot" && this.isGraceProtectedHuman(target)) continue;

      const dx = target.position.x - attacker.position.x;
      const dz = target.position.z - attacker.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > range) continue;

      const align = (dx * fx + dz * fz) / Math.max(0.001, dist);
      if (align < -0.35) continue;

      const dir = normalize2(dx, dz);
      const versusHuman = this.mode === "solo" && attacker.role === "bot" && target.role === "human";
      const pressure = versusHuman ? this.soloBotPlayerPressureScale() : 1;
      target.velocity.x += dir.x * impulse * pressure;
      target.velocity.y += (isHeavy ? 4.6 : 2.8) * pressure;
      target.velocity.z += dir.z * impulse * pressure;
      target.stun += damage * pressure;

      // Update ragdoll hints
      target.lastHitDirX = dir.x;
      target.lastHitDirZ = dir.z;
      target.ragdollState = "hit";
      target.ragdollStiffness = isHeavy ? 0.15 : 0.35;
      target.ragdollRecoveryTimer = isHeavy ? 0.4 : 0.25;

      if (target.grabbedById) {
        this.releaseGrab(target.grabbedById);
      }

      if (target.stun >= STUN_KNOCKOUT_THRESHOLD) {
        this.knockout(target.id, "stun-overload", attacker.id);
      } else {
        this.onRoundEvent({
          type: "hit",
          actorId: attacker.id,
          targetId: target.id,
          atTick: this.serverTick,
          message: isHeavy ? "heavy" : "light",
        });
      }
    }

    if (isHeavy) {
      attacker.attackCooldownHeavy = HEAVY_ATTACK_COOLDOWN;
    } else {
      attacker.attackCooldownLight = LIGHT_ATTACK_COOLDOWN;
    }
  }

  private resolvePlayerCollisions(): void {
    const alivePlayers = [...this.players.values()].filter((player) => player.alive);
    const minDist = PLAYER_RADIUS * 2;

    for (let i = 0; i < alivePlayers.length; i += 1) {
      for (let j = i + 1; j < alivePlayers.length; j += 1) {
        const a = alivePlayers[i];
        const b = alivePlayers[j];

        if (a.grabbedById === b.id || b.grabbedById === a.id) continue;

        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist >= minDist || dist < 1e-5) continue;

        const overlap = minDist - dist;
        const nx = dx / dist;
        const nz = dz / dist;

        a.position.x -= nx * overlap * 0.5;
        a.position.z -= nz * overlap * 0.5;
        b.position.x += nx * overlap * 0.5;
        b.position.z += nz * overlap * 0.5;

        a.velocity.x -= nx * 0.55;
        a.velocity.z -= nz * 0.55;
        b.velocity.x += nx * 0.55;
        b.velocity.z += nz * 0.55;
      }
    }
  }

  private updateHazards(dt: number): void {
    const intensity = this.roundState.suddenDeath ? 1.65 : 1;

    for (const hazard of this.hazards) {
      hazard.phase += dt * hazard.speed * intensity;

      if (hazard.kind === "moving_crate") {
        if (hazard.axis === "x") {
          hazard.position.x = hazard.basePositionX + Math.sin(hazard.phase) * hazard.amplitude;
          hazard.velocity.x = Math.cos(hazard.phase) * hazard.amplitude * hazard.speed * intensity;
          hazard.velocity.z = 0;
        } else {
          hazard.position.z = hazard.basePositionZ + Math.sin(hazard.phase) * hazard.amplitude;
          hazard.velocity.z = Math.cos(hazard.phase) * hazard.amplitude * hazard.speed * intensity;
          hazard.velocity.x = 0;
        }
      }

      if (hazard.kind === "sweeper") {
        const radius = hazard.amplitude;
        hazard.position.x = Math.cos(hazard.phase) * radius;
        hazard.position.z = Math.sin(hazard.phase) * radius;
        hazard.velocity.x = -Math.sin(hazard.phase) * radius * hazard.speed * intensity;
        hazard.velocity.z = Math.cos(hazard.phase) * radius * hazard.speed * intensity;
      }

      if (hazard.kind === "conveyor") {
        hazard.velocity.x = Math.sin(hazard.phase) * 4.5 * intensity;
        hazard.velocity.z = 0;
      }

      if (hazard.kind === "press") {
        hazard.cycle -= dt * intensity;
        if (hazard.cycle <= 0) {
          hazard.cycle = 2.6;
          hazard.cooldown = 0.55;
        }

        if (hazard.cooldown > 0) {
          hazard.cooldown -= dt;
          hazard.active = true;
          hazard.position.y = 1.4 - (hazard.cooldown / 0.55) * 1.1;
        } else {
          hazard.active = false;
          hazard.position.y = 1.4;
        }

        hazard.velocity.y = hazard.active ? -8 : 0;
      }
    }
  }

  private applyHazards(dt: number): void {
    const intensity = this.roundState.suddenDeath ? 1.45 : 1;

    for (const player of this.players.values()) {
      if (!player.alive) continue;
      const graceProtected = this.isGraceProtectedHuman(player);
      const graceScale = graceProtected ? 0.28 : 1;

      for (const hazard of this.hazards) {
        if (!hazard.active) continue;

        if (hazard.kind === "conveyor") {
          const nearZ = Math.abs(player.position.z - hazard.position.z) <= hazard.radius * 0.65;
          const nearX = Math.abs(player.position.x - hazard.position.x) <= hazard.radius + 4;
          if (nearZ && nearX) {
            player.velocity.x += hazard.velocity.x * dt * 0.9 * graceScale;
            player.stun += dt * 4 * intensity * graceScale;
          }
          continue;
        }

        const dx = player.position.x - hazard.position.x;
        const dy = player.position.y - hazard.position.y;
        const dz = player.position.z - hazard.position.z;
        const dist = Math.hypot(dx, dy, dz);
        const hitDist = hazard.radius + PLAYER_RADIUS;
        if (dist > hitDist) continue;

        const invLen = 1 / Math.max(0.001, dist);
        const nx = dx * invLen;
        const ny = dy * invLen;
        const nz = dz * invLen;

        const hazardSpeed = Math.hypot(hazard.velocity.x, hazard.velocity.y, hazard.velocity.z);
        const push = 3.2 + hazardSpeed * 0.45;

        player.velocity.x += nx * push * graceScale;
        player.velocity.y += (ny * push * 0.8 + 1.1) * graceScale;
        player.velocity.z += nz * push * graceScale;
        player.stun += (HAZARD_STUN_DAMAGE * 0.02 * intensity + hazardSpeed * 0.09) * graceScale;

        this.onRoundEvent({
          type: "hazard_hit",
          targetId: player.id,
          atTick: this.serverTick,
        });

        if (graceProtected) {
          continue;
        }
        if (hazard.kind === "press") {
          this.knockout(player.id, "hazard-impact");
        } else if (hazardSpeed > 7.2 && player.stun > STUN_KNOCKOUT_THRESHOLD * 0.85) {
          this.knockout(player.id, "hazard-impact");
        }
      }

      if (player.stun >= STUN_KNOCKOUT_THRESHOLD) {
        this.knockout(player.id, "stun-overload");
      }
    }
  }

  private knockout(targetId: string, reason: string, actorId?: string): void {
    const player = this.players.get(targetId);
    if (!player || !player.alive) return;
    if (this.mode === "practice" && player.role === "human") {
      const bounds = arenaBounds(this.arena);
      player.position.x = clamp(player.position.x, bounds.minX + 2.5, bounds.maxX - 2.5);
      player.position.y = bounds.floorY + PLAYER_RADIUS;
      player.position.z = clamp(player.position.z, bounds.minZ + 2.5, bounds.maxZ - 2.5);
      player.velocity.x = 0;
      player.velocity.y = 0;
      player.velocity.z = 0;
      player.stun = Math.min(player.stun, STUN_KNOCKOUT_THRESHOLD * 0.25);
      return;
    }
    if (this.mode === "solo" && player.role === "human" && this.roundTimer < SOLO_EDGE_PROTECTION_SECONDS) {
      const bounds = arenaBounds(this.arena);
      player.position.x = clamp(player.position.x, bounds.minX + 1.8, bounds.maxX - 1.8);
      player.position.y = bounds.floorY + PLAYER_RADIUS;
      player.position.z = clamp(player.position.z, bounds.minZ + 1.8, bounds.maxZ - 1.8);
      player.velocity.x = 0;
      player.velocity.y = 0;
      player.velocity.z = 0;
      player.stun = Math.min(player.stun, STUN_KNOCKOUT_THRESHOLD * 0.35);
      return;
    }

    if (player.grabbedById) {
      this.releaseGrab(player.grabbedById);
    }
    this.releaseGrab(player.id);

    player.alive = false;
    player.position.y = -30;
    player.velocity.x = 0;
    player.velocity.y = 0;
    player.velocity.z = 0;
    player.knockouts += 1;

    // Ragdoll hints: full knockout
    player.ragdollState = "knockout";
    player.ragdollStiffness = 0;
    player.ragdollRecoveryTimer = 1.2;

    this.onRoundEvent({
      type: "knockout",
      actorId,
      targetId,
      atTick: this.serverTick,
      message: reason,
    });
  }

  private finishRound(): void {
    const alive = [...this.players.values()].filter((player) => player.alive);
    const winner = alive.length === 1 ? alive[0] : null;

    this.roundState.roundWinnerId = winner?.id ?? null;
    if (winner) {
      this.roundState.scoreboard[winner.id] = (this.roundState.scoreboard[winner.id] ?? 0) + 1;
      winner.wins = this.roundState.scoreboard[winner.id];
    }

    for (const player of this.players.values()) {
      player.wins = this.roundState.scoreboard[player.id] ?? 0;
      player.latestInput = { ...EMPTY_INPUT, tick: this.serverTick };
      player.isReady = player.role === "bot" ? true : player.isReady;
    }

    const reachedWins = winner && this.roundState.scoreboard[winner.id] >= WINS_TO_WIN_MATCH;
    const reachedRoundCap = this.roundState.roundNumber >= BEST_OF_ROUNDS;

    if (reachedWins || reachedRoundCap) {
      this.roundState.phase = "match_over";
      this.roundState.matchWinnerId = this.resolveMatchWinner();
      this.roundState.roundTimeLeft = 0;

      this.onRoundEvent({
        type: "match_end",
        actorId: this.roundState.matchWinnerId ?? undefined,
        atTick: this.serverTick,
      });
      return;
    }

    this.roundState.phase = "between_rounds";
    this.betweenRoundTimer = 5;
    this.roundState.roundTimeLeft = this.betweenRoundTimer;

    this.onRoundEvent({
      type: "round_end",
      actorId: winner?.id,
      atTick: this.serverTick,
    });
  }

  private resolveMatchWinner(): string | null {
    const entries = Object.entries(this.roundState.scoreboard);
    entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return entries.length > 0 ? entries[0][0] : null;
  }

  private startRound(): void {
    this.roundState.phase = "active";
    this.roundTimer = 0;
    this.roundState.roundTimeLeft = ROUND_DURATION_SECONDS;
    this.roundState.roundWinnerId = null;
    this.roundState.suddenDeath = false;
    this.roundState.roundNumber += 1;
    this.arena = ARENAS[(this.roundState.roundNumber - 1) % ARENAS.length];
    this.roundState.arena = this.arena;

    this.spawnPositions = createSpawnPositions(this.arena, Math.max(MAX_PLAYERS, this.players.size));
    this.spawnCursor = 0;

    const bots = [...this.players.values()].filter((player) => player.role === "bot").sort((a, b) => a.id.localeCompare(b.id));
    const humans = [...this.players.values()].filter((player) => player.role === "human");
    let queuedIndex = 0;

    for (const player of [...humans, ...bots]) {
      this.resetPlayerForRound(player);

      if (this.mode === "solo" && player.role === "human") {
        this.spawnSoloHumanSafely(player);
        continue;
      }

      if (this.mode === "solo" && player.role === "bot") {
        if (queuedIndex < SOLO_INITIAL_ACTIVE_BOTS) {
          this.spawnPlayer(player);
          queuedIndex += 1;
        } else {
          player.queuedSpawn = true;
          player.spawnDelay = 2 + (queuedIndex - SOLO_INITIAL_ACTIVE_BOTS) * SOLO_BOT_SPAWN_INTERVAL_SECONDS;
          player.alive = false;
          player.position.y = -30;
          queuedIndex += 1;
        }
        continue;
      }

      this.spawnPlayer(player);
    }

    this.createHazardsForArena(this.arena);
    this.roundState.survivors = [...this.players.keys()];

    this.onRoundEvent({
      type: "round_start",
      atTick: this.serverTick,
      message: this.arena,
    });
  }

  private createHazardsForArena(arena: ArenaId): void {
    if (this.mode === "practice") {
      this.hazards = [];
      return;
    }

    if (arena === "cargo_rooftop") {
      this.hazards = [
        {
          id: "crate-a",
          kind: "moving_crate",
          position: { x: 0, y: 0.5, z: -2.8 },
          velocity: { x: 0, y: 0, z: 0 },
          radius: 1.0,
          active: true,
          basePositionX: 0,
          basePositionZ: -2.8,
          amplitude: 6.5,
          speed: 1.45,
          axis: "x",
          phase: 0,
          cycle: 0,
          cooldown: 0,
        },
        {
          id: "crate-b",
          kind: "moving_crate",
          position: { x: 0, y: 0.5, z: 2.6 },
          velocity: { x: 0, y: 0, z: 0 },
          radius: 1.0,
          active: true,
          basePositionX: 0,
          basePositionZ: 2.6,
          amplitude: 6.1,
          speed: 1.75,
          axis: "x",
          phase: Math.PI,
          cycle: 0,
          cooldown: 0,
        },
      ];
      return;
    }

    if (arena === "ferry_deck") {
      this.hazards = [
        {
          id: "sweeper-main",
          kind: "sweeper",
          position: { x: 5.3, y: 0.5, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          radius: 1.15,
          active: true,
          basePositionX: 0,
          basePositionZ: 0,
          amplitude: 5.8,
          speed: 1.35,
          axis: "x",
          phase: 0,
          cycle: 0,
          cooldown: 0,
        },
      ];
      return;
    }

    this.hazards = [
      {
        id: "conv-a",
        kind: "conveyor",
        position: { x: 0, y: 0.2, z: -1.9 },
        velocity: { x: 0, y: 0, z: 0 },
        radius: 2.1,
        active: true,
        basePositionX: 0,
        basePositionZ: -1.9,
        amplitude: 3.5,
        speed: 1.1,
        axis: "x",
        phase: 0,
        cycle: 0,
        cooldown: 0,
      },
      {
        id: "conv-b",
        kind: "conveyor",
        position: { x: 0, y: 0.2, z: 2.2 },
        velocity: { x: 0, y: 0, z: 0 },
        radius: 2.1,
        active: true,
        basePositionX: 0,
        basePositionZ: 2.2,
        amplitude: 3.8,
        speed: 1.3,
        axis: "x",
        phase: Math.PI,
        cycle: 0,
        cooldown: 0,
      },
      {
        id: "press-a",
        kind: "press",
        position: { x: -3.2, y: 1.4, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        radius: 1,
        active: false,
        basePositionX: -3.2,
        basePositionZ: 0,
        amplitude: 0,
        speed: 1,
        axis: "x",
        phase: 0,
        cycle: 1.2,
        cooldown: 0,
      },
      {
        id: "press-b",
        kind: "press",
        position: { x: 3.2, y: 1.4, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        radius: 1,
        active: false,
        basePositionX: 3.2,
        basePositionZ: 0,
        amplitude: 0,
        speed: 1,
        axis: "x",
        phase: 0,
        cycle: 2,
        cooldown: 0,
      },
    ];
  }

  private ensureSoloBots(): void {
    const humans = [...this.humanIds].map((id) => this.players.get(id)).filter(Boolean) as InternalPlayerState[];

    if (humans.length === 0) {
      for (const [id, player] of this.players) {
        if (player.role === "bot") this.players.delete(id);
      }
      return;
    }

    const expectedBots = Math.max(0, MAX_PLAYERS - humans.length);
    const currentBots = [...this.players.values()].filter((player) => player.role === "bot");

    if (currentBots.length > expectedBots) {
      for (let i = expectedBots; i < currentBots.length; i += 1) {
        this.players.delete(currentBots[i].id);
      }
    }

    let idx = 1;
    while ([...this.players.values()].filter((player) => player.role === "bot").length < expectedBots) {
      const id = `bot-${idx}`;
      idx += 1;
      if (this.players.has(id)) continue;

      const bot = createPlayer(id, fallbackName("Bot", idx), "bot");
      bot.connected = true;
      bot.isReady = true;
      bot.botDifficulty = "normal";
      bot.botMind = {
        state: "roam",
        decisionTimer: 0,
        targetId: null,
        wanderAngle: Math.random() * Math.PI * 2,
      };
      this.players.set(id, bot);
      this.roundState.scoreboard[id] = this.roundState.scoreboard[id] ?? 0;
    }
  }

  private resetPlayerForRound(player: InternalPlayerState): void {
    player.alive = true;
    player.velocity.x = 0;
    player.velocity.y = 0;
    player.velocity.z = 0;
    player.stun = 0;
    player.grabbedById = null;
    player.grabbedTargetId = null;
    player.attackCooldownLight = 0;
    player.attackCooldownHeavy = 0;
    player.grabCooldown = 0;
    player.latestInput = { ...EMPTY_INPUT, tick: this.serverTick };
    player.rematchVote = false;
    player.emoteTimer = 0;
    player.queuedSpawn = false;
    player.spawnDelay = 0;
    player.ragdollStiffness = 1;
    player.ragdollState = "active";
    player.lastHitDirX = 0;
    player.lastHitDirZ = 0;
    player.ragdollRecoveryTimer = 0;
  }

  private spawnPlayer(player: InternalPlayerState): void {
    const pos = this.spawnPositions[this.spawnCursor % this.spawnPositions.length];
    this.spawnCursor += 1;
    player.alive = true;
    player.position.x = pos.x;
    player.position.y = pos.y;
    player.position.z = pos.z;
    player.queuedSpawn = false;
    player.spawnDelay = 0;
  }

  private spawnSoloHumanSafely(player: InternalPlayerState): void {
    const bounds = arenaBounds(this.arena);
    player.alive = true;
    player.position.x = 0;
    player.position.y = bounds.floorY + PLAYER_RADIUS;
    player.position.z = 0;
    player.queuedSpawn = false;
    player.spawnDelay = 0;
  }

  private updateSoloBotSpawns(dt: number): void {
    if (this.mode !== "solo" || this.roundState.phase !== "active") return;

    const bots = [...this.players.values()].filter((player) => player.role === "bot");
    const activeBots = bots.filter((player) => player.alive).length;
    const dynamicCap = Math.min(
      SOLO_MAX_ACTIVE_BOTS,
      SOLO_INITIAL_ACTIVE_BOTS + Math.floor(this.roundTimer / SOLO_BOT_CAP_RAMP_SECONDS),
    );

    let slots = Math.max(0, dynamicCap - activeBots);
    if (slots === 0) return;

    for (const bot of bots) {
      if (!bot.queuedSpawn) continue;
      bot.spawnDelay = Math.max(0, bot.spawnDelay - dt);
      if (bot.spawnDelay > 0 || slots <= 0) continue;
      this.spawnPlayer(bot);
      slots -= 1;
    }
  }

  private isGraceProtectedHuman(player: InternalPlayerState): boolean {
    return this.mode === "solo" && player.role === "human" && this.roundTimer < SOLO_GRACE_SECONDS;
  }

  private isEdgeProtectedHuman(player: InternalPlayerState): boolean {
    return this.mode === "solo" && player.role === "human" && this.roundTimer < SOLO_EDGE_PROTECTION_SECONDS;
  }

  private soloBotAggressionScale(): number {
    if (this.mode !== "solo" || this.roundState.phase !== "active") return 1;
    if (this.roundTimer < SOLO_GRACE_SECONDS) return 0.18;
    const rampT = clamp((this.roundTimer - SOLO_GRACE_SECONDS) / SOLO_BOT_SPEED_RAMP_SECONDS, 0, 1);
    return 0.3 + rampT * 0.45;
  }

  private soloBotPlayerPressureScale(): number {
    if (this.mode !== "solo") return 1;
    const rampT = clamp((this.roundTimer - SOLO_GRACE_SECONDS) / 40, 0, 1);
    return 0.3 + rampT * 0.6;
  }

  private hasQueuedSoloBots(): boolean {
    if (this.mode !== "solo") return false;
    for (const player of this.players.values()) {
      if (player.role === "bot" && player.queuedSpawn) return true;
    }
    return false;
  }

  private shouldFinishRound(): boolean {
    if (this.mode === "practice") return false;
    if (this.roundState.roundTimeLeft <= 0) return true;
    if (this.roundState.survivors.length > 1) return false;
    if (this.mode !== "solo") return true;
    if (this.roundTimer < SOLO_MIN_ROUND_SECONDS) return false;
    return !this.hasQueuedSoloBots();
  }

  private resetForRematch(): void {
    this.roundState = {
      ...this.roundState,
      phase: "lobby",
      roundNumber: 0,
      roundTimeLeft: 0,
      suddenDeath: false,
      readyCount: 0,
      targetReadyCount: this.humanIds.size,
      survivors: [],
      roundWinnerId: null,
      matchWinnerId: null,
      scoreboard: Object.fromEntries([...this.players.keys()].map((id) => [id, 0])),
    };

    for (const player of this.players.values()) {
      player.wins = 0;
      player.knockouts = 0;
      player.rematchVote = false;
      player.isReady = this.mode === "solo" || this.mode === "practice" || player.role === "bot";
      player.latestInput = { ...EMPTY_INPUT, tick: this.serverTick };
      player.stun = 0;
      player.alive = true;
      player.grabbedById = null;
      player.grabbedTargetId = null;
    }

    this.hazards = [];
    this.roundTimer = 0;
    this.betweenRoundTimer = 0;
    this.countdownTimer = 0;
    this.arena = ARENAS[0];
    this.roundState.arena = this.arena;
  }
}
