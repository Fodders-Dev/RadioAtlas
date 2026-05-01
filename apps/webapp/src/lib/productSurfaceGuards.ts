export const PRODUCT_SURFACE_GUARDS = {
  billing: false,
  stars: false,
  marketplace: false,
  paidPacks: false,
  publicCollections: false,
  editorialPortal: false,
  ownerDashboard: false,
  stationClaims: false
} as const;

export type ProductSurfaceKey = keyof typeof PRODUCT_SURFACE_GUARDS;

export const shouldExposeProductSurface = (surface: ProductSurfaceKey) =>
  PRODUCT_SURFACE_GUARDS[surface];
