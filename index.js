// -----------------------------------------------------------------------------
// Entry point of the AppTable Elior integration for Gladys Assistant.
//
// The whole integration lives in src/app.js, which takes the Gladys client as
// a parameter (the tests pass the fake Gladys of the SDK). This file only
// creates the real client, connects, and stops cleanly.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them itself: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const gladys = new GladysIntegration();
const app = createApp(gladys);

// The SDK disconnects cleanly and exits with code 0 on SIGTERM/SIGINT.
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  app.stop();
});

logger.info('Starting the AppTable Elior integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
