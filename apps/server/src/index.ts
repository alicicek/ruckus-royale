import http from "node:http";
import cors from "cors";
import express from "express";
import { Server, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME } from "@ruckus/shared";
import { BrawlRoom } from "./rooms/BrawlRoom";

const port = Number(process.env.PORT ?? 2567);

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer,
  }),
});

gameServer.define(ROOM_NAME, BrawlRoom).filterBy(["roomCode", "mode"]);

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    roomType: ROOM_NAME,
    timestamp: new Date().toISOString(),
  });
});

app.get("/rooms", async (_req, res) => {
  const rooms = await matchMaker.query({
    name: ROOM_NAME,
  });

  res.json({
    rooms: rooms.map((room) => ({
      roomId: room.roomId,
      clients: room.clients,
      maxClients: room.maxClients,
      metadata: room.metadata,
    })),
  });
});

httpServer.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] Ruckus Royale running on http://localhost:${port}`);
});
