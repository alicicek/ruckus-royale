import { BOT_BASE_REACTION_SECONDS, GRAB_RANGE } from "@ruckus/shared";
import { edgeDistance } from "@ruckus/shared";
import type { ArenaId, InputFrame } from "@ruckus/shared";
import type { InternalHazard, InternalPlayerState } from "../sim/types";

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

function nearestThreatDistance(bot: InternalPlayerState, hazards: InternalHazard[]): number {
  let closest = Number.POSITIVE_INFINITY;
  for (const hazard of hazards) {
    if (!hazard.active) continue;
    const dx = hazard.position.x - bot.position.x;
    const dz = hazard.position.z - bot.position.z;
    const dist = Math.hypot(dx, dz) - hazard.radius;
    closest = Math.min(closest, dist);
  }
  return closest;
}

function findNearestEnemy(bot: InternalPlayerState, players: InternalPlayerState[]): InternalPlayerState | null {
  let nearest: InternalPlayerState | null = null;
  let nearestSq = Number.POSITIVE_INFINITY;

  for (const candidate of players) {
    if (!candidate.alive || candidate.id === bot.id) continue;
    const dx = candidate.position.x - bot.position.x;
    const dz = candidate.position.z - bot.position.z;
    const sq = dx * dx + dz * dz;
    if (sq < nearestSq) {
      nearestSq = sq;
      nearest = candidate;
    }
  }

  return nearest;
}

export function buildBotInput(params: {
  tick: number;
  dt: number;
  arena: ArenaId;
  bot: InternalPlayerState;
  players: InternalPlayerState[];
  hazards: InternalHazard[];
}): InputFrame {
  const { tick, dt, arena, bot, players, hazards } = params;
  const out: InputFrame = { ...EMPTY_INPUT, tick };

  if (!bot.botMind || !bot.botDifficulty || !bot.alive) {
    return out;
  }

  bot.botMind.decisionTimer -= dt;
  const reaction = BOT_BASE_REACTION_SECONDS[bot.botDifficulty];
  const nearestEnemy = findNearestEnemy(bot, players);
  const threatDistance = nearestThreatDistance(bot, hazards);
  const edgeGap = edgeDistance(arena, bot.position);

  if (bot.botMind.decisionTimer <= 0) {
    bot.botMind.decisionTimer = reaction;

    if (edgeGap < 1.35) {
      bot.botMind.state = "recover_edge";
    } else if (threatDistance < 1.5) {
      bot.botMind.state = "disengage_hazard";
    } else if (nearestEnemy) {
      const dx = nearestEnemy.position.x - bot.position.x;
      const dz = nearestEnemy.position.z - bot.position.z;
      const dist = Math.hypot(dx, dz);
      bot.botMind.state = dist < GRAB_RANGE * 0.9 && Math.random() > 0.58 ? "opportunistic_grab" : "chase";
      bot.botMind.targetId = nearestEnemy.id;
    } else {
      bot.botMind.state = "roam";
      bot.botMind.wanderAngle += 0.4 + Math.random();
      bot.botMind.targetId = null;
    }
  }

  switch (bot.botMind.state) {
    case "recover_edge": {
      out.moveX = -Math.sign(bot.position.x) || 1;
      out.moveZ = -Math.sign(bot.position.z) || 1;
      out.jump = bot.position.y <= 0.55;
      out.sprint = true;
      break;
    }
    case "disengage_hazard": {
      let pushX = 0;
      let pushZ = 0;
      for (const hazard of hazards) {
        if (!hazard.active) continue;
        const dx = bot.position.x - hazard.position.x;
        const dz = bot.position.z - hazard.position.z;
        const distSq = dx * dx + dz * dz;
        if (distSq < 12.25) {
          const invLen = 1 / Math.max(0.001, Math.sqrt(distSq));
          pushX += dx * invLen;
          pushZ += dz * invLen;
        }
      }
      out.moveX = pushX;
      out.moveZ = pushZ;
      out.sprint = true;
      if (Math.random() > 0.8) out.jump = true;
      break;
    }
    case "opportunistic_grab": {
      const target = players.find((p) => p.id === bot.botMind?.targetId);
      if (target && target.alive) {
        out.moveX = target.position.x - bot.position.x;
        out.moveZ = target.position.z - bot.position.z;
        const dist = Math.hypot(out.moveX, out.moveZ);
        if (dist < GRAB_RANGE * 0.88) {
          out.grab = true;
          out.lightAttack = Math.random() > 0.7;
        }
      }
      break;
    }
    case "chase": {
      const target = players.find((p) => p.id === bot.botMind?.targetId && p.alive) ?? nearestEnemy;
      if (target) {
        out.moveX = target.position.x - bot.position.x;
        out.moveZ = target.position.z - bot.position.z;
        const dist = Math.hypot(out.moveX, out.moveZ);
        if (dist < 1.7 && Math.random() > 0.63) out.lightAttack = true;
        if (dist < 2.2 && Math.random() > 0.85) out.heavyAttack = true;
        if (dist > 3.8) out.sprint = true;
        if (Math.abs(target.position.y - bot.position.y) > 0.65 && Math.random() > 0.65) out.jump = true;
      }
      break;
    }
    case "roam":
    default: {
      out.moveX = Math.cos(bot.botMind.wanderAngle);
      out.moveZ = Math.sin(bot.botMind.wanderAngle);
      if (Math.random() > 0.97) out.emote = true;
      if (Math.random() > 0.985) out.jump = true;
      break;
    }
  }

  const mag = Math.hypot(out.moveX, out.moveZ);
  if (mag > 1e-3) {
    out.moveX /= Math.max(1, mag);
    out.moveZ /= Math.max(1, mag);
  }

  return out;
}
