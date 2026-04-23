import type express from 'express';
import { createExtractorHandler } from './media/extractorProxy.js';
import { createMetadataHandler } from './media/metadataService.js';
import { createFetchHandler, createImageHandler, createStreamHandler } from './media/streamProxy.js';
import type { MediaRouteOptions } from './media/types.js';

export const registerMediaRoutes = (
  app: express.Express,
  options: MediaRouteOptions
) => {
  app.get('/stream', createStreamHandler(options));
  app.get('/image', createImageHandler(options));
  app.get('/metadata', createMetadataHandler(options));
  app.get('/extract', createExtractorHandler(options));
  app.get('/fetch', createFetchHandler(options));
};
