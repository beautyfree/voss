import { Elysia } from "elysia";

export const healthRoutes = new Elysia({ prefix: "/api" })
  .get("/health", () => ({
    status: "ok",
    version: "0.1.0",
    uptime: process.uptime(),
  }));
