import type { MyWebSocket, ConnectionData } from "@/types/websocket";

class ConnectionStore {
  private connections = new Map<MyWebSocket, ConnectionData>();

  add(ws: MyWebSocket, data: ConnectionData) {
    this.connections.set(ws, data);
  }

  get(ws: MyWebSocket) {
    return this.connections.get(ws);
  }

  delete(ws: MyWebSocket) {
    this.connections.delete(ws);
  }

  getAllConnections() {
    return this.connections;
  }
}

export const connectionStore = new ConnectionStore();
