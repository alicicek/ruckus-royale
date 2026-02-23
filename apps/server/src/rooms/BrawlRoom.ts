import { Room, type Client } from "@colyseus/core";
import { MAX_PLAYERS, ROOM_NAME, SERVER_TICK_DT, SNAPSHOT_RATE, type InputFrame, type JoinRoomPayload, type ReadyStatePayload, type RematchVotePayload } from "@ruckus/shared";
import { BrawlSimulation } from "../sim/simulation";

const SAFE_NAME_PATTERN = /[^a-zA-Z0-9 _-]/g;

function normalizePlayerName(name: string): string {
  const trimmed = (name || "Player").trim().slice(0, 18);
  return trimmed.replace(SAFE_NAME_PATTERN, "") || "Player";
}

function normalizeRoomCode(code?: string): string | undefined {
  const cleaned = (code ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned || undefined;
}

const RATE_LIMIT_MAX = 75;
const RATE_LIMIT_WINDOW_MS = 1000;

export class BrawlRoom extends Room {
  private simulation!: BrawlSimulation;
  private rateLimiters = new Map<string, { count: number; resetAt: number }>();

  maxClients = MAX_PLAYERS;

  async onAuth(_client: Client, options: Partial<JoinRoomPayload>): Promise<boolean> {
    const requested = normalizeRoomCode(options.roomCode);
    if (!requested) return true;

    const current = this.metadata?.roomCode as string | undefined;
    if (!current) return true;
    return requested === current;
  }

  private isRateLimited(clientId: string): boolean {
    const now = Date.now();
    let entry = this.rateLimiters.get(clientId);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
      this.rateLimiters.set(clientId, entry);
    }
    entry.count += 1;
    return entry.count > RATE_LIMIT_MAX;
  }

  onCreate(options: Partial<JoinRoomPayload>): void {
    const mode = options.mode === "solo" || options.mode === "practice" ? options.mode : "online";
    this.maxClients = mode === "practice" ? 1 : MAX_PLAYERS;
    const roomCode = normalizeRoomCode(options.roomCode);

    this.simulation = new BrawlSimulation({
      mode,
      roomCode: roomCode ?? "",
      onRoundEvent: (roundEvent) => this.broadcast("round_event", roundEvent),
    });

    this.setMetadata({
      mode,
      roomCode: this.simulation.roomCode,
      roomName: ROOM_NAME,
    });

    this.onMessage("join_room", (client, payload: JoinRoomPayload) => {
      const player = normalizePlayerName(payload.playerName || "Player");
      this.simulation.addHumanPlayer(client.sessionId, player);
      client.send("sync_tick", { serverTick: this.simulation.serverTick });
    });

    this.onMessage("player_input", (client, payload: InputFrame) => {
      if (this.isRateLimited(client.sessionId)) return;

      if (typeof payload.tick !== "number" || !Number.isFinite(payload.tick)) return;
      if (typeof payload.moveX !== "number" || !Number.isFinite(payload.moveX)) return;
      if (typeof payload.moveZ !== "number" || !Number.isFinite(payload.moveZ)) return;
      if (typeof payload.jump !== "boolean") return;
      if (typeof payload.grab !== "boolean") return;
      if (typeof payload.lightAttack !== "boolean") return;
      if (typeof payload.heavyAttack !== "boolean") return;
      if (typeof payload.sprint !== "boolean") return;
      if (typeof payload.emote !== "boolean") return;

      payload.moveX = Math.max(-1, Math.min(1, payload.moveX));
      payload.moveZ = Math.max(-1, Math.min(1, payload.moveZ));

      this.simulation.applyInput(client.sessionId, payload);
    });

    this.onMessage("ready_state", (client, payload: ReadyStatePayload) => {
      this.simulation.setReady(client.sessionId, Boolean(payload.ready));
    });

    this.onMessage("vote_rematch", (client, payload: RematchVotePayload) => {
      this.simulation.setRematchVote(client.sessionId, Boolean(payload.vote));
    });

    this.setSimulationInterval(() => {
      this.simulation.step(SERVER_TICK_DT);
    }, 1000 / 60);

    this.clock.setInterval(() => {
      this.broadcast("snapshot", this.simulation.getStateSnapshot());
    }, 1000 / SNAPSHOT_RATE);
  }

  onJoin(client: Client, _options: Partial<JoinRoomPayload>): void {
    client.send("room_info", {
      roomCode: this.simulation.roomCode,
      mode: this.simulation.mode,
      playerId: client.sessionId,
    });

    this.broadcast("snapshot", this.simulation.getStateSnapshot());
  }

  onLeave(client: Client): void {
    this.simulation.removeHumanPlayer(client.sessionId);
    this.rateLimiters.delete(client.sessionId);

    if (this.simulation.getHumanCount() === 0) {
      this.disconnect();
      return;
    }

    this.broadcast("snapshot", this.simulation.getStateSnapshot());
  }
}
