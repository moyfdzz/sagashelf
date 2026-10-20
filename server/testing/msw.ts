import { setupServer } from "msw/node";

/**
 * Shared mock server for every test. Each external provider adds its own
 * fixtures and handlers here, so tests never reach the real network.
 */
export const mswServer = setupServer();
