export * from './Primitives';
export * from './FieldInputs';
export * from './Ops';
export * from './Zones';
export * from './FieldUtils';

import { registerGeometryPrimitives } from './Primitives';
import { registerGeoFieldInputs } from './FieldInputs';
import { registerGeometryOps } from './Ops';
import { registerZoneNodes } from './Zones';
import { registerFieldUtilNodes } from './FieldUtils';

/** Registers the full M2/M3/M4 geometry node pack. */
export function registerGeometryNodes(): void {
  registerGeometryPrimitives();
  registerGeoFieldInputs();
  registerGeometryOps();
  registerZoneNodes();
  registerFieldUtilNodes();
}
