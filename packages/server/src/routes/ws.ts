import { Elysia } from "elysia";
import { subscribeToLogs } from "./deploy";

export const wsRoutes = new Elysia()
  .ws("/ws/logs/:deploymentId", {
    open(ws) {
      const deploymentId = (ws.data as any).params.deploymentId;
      const unsub = subscribeToLogs(deploymentId, (msg) => {
        // msg is already JSON string for status, plain string for logs
        try {
          JSON.parse(msg); // Already JSON (status broadcast)
          ws.send(msg);
        } catch {
          ws.send(JSON.stringify({ type: "log", data: msg }));
        }
      });
      (ws as any)._unsub = unsub;
    },
    message(_ws, _message) {},
    close(ws) {
      const unsub = (ws as any)._unsub;
      if (unsub) unsub();
    },
  });
