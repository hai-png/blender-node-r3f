export * from './Primitives';
export * from './FieldInputs';
export * from './Ops';
export * from './Zones';
export * from './FieldUtils';
export * from './SceneInputs';
export * from './CurveRead';

import { registerGeometryPrimitives } from './Primitives';
import { registerGeoFieldInputs } from './FieldInputs';
import { registerGeometryOps } from './Ops';
import { registerZoneNodes } from './Zones';
import { registerFieldUtilNodes } from './FieldUtils';
import { registerSceneInputNodes } from './SceneInputs';
import { registerCurveReadWriteNodes } from './CurveRead';

/** Registers the full M2/M3/M4 geometry node pack + Phase 2C extensions. */
export function registerGeometryNodes(): void {
  registerGeometryPrimitives();
  registerGeoFieldInputs();
  registerGeometryOps();
  registerZoneNodes();
  registerFieldUtilNodes();
  registerSceneInputNodes();
  registerCurveReadWriteNodes();
}
