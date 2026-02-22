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

export class BrawlRoom extends Room {
  private simulation!: BrawlSimulation;

  maxClients = MAX_PLAYERS;

  async onAuth(_client: Client, options: Partial<JoinRoomPayload>): Promise<boolean> {
    const requested = normalizeRoomCode(options.roomCode);
    if (!requested) return true;

    const current = this.metadata?.roomCode as string | undefined;
    if (!current) return true;
    return requested === current;
  }

  onCreate(options: Partial<JoinRoomPayload>): void {
    const mode = options.mode === "solo" ? "solo" : "online";
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
    });

    this.onMessage("player_input", (client, payload: InputFrame) => {
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

  onJoin(client: Client, options: Partial<JoinRoomPayload>): void {
    const playerName = normalizePlayerName(options.playerName || "Player");
    this.simulation.addHumanPlayer(client.sessionId, playerName);

    client.send("room_info", {
      roomCode: this.simulation.roomCode,
      mode: this.simulation.mode,
      playerId: client.sessionId,
    });

    this.broadcast("snapshot", this.simulation.getStateSnapshot());
  }

  onLeave(client: Client): void {
    this.simulation.removeHumanPlayer(client.sessionId);

    if (this.simulation.getHumanCount() === 0) {
      this.disconnect();
      return;
    }

    this.broadcast("snapshot", this.simulation.getStateSnapshot());
  }
}
