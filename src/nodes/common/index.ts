export * from './Math';
export * from './VectorMath';
export * from './Value';
export * from './MixColor';
export * from './MapRange';
export * from './Clamp';
export * from './CombineSeparate';
export * from './ColorRamp';
export * from './Logic';
export * from './Frame';
export * from './Group';
export * from './Curves';

import { registerMathNode } from './Math';
import { registerVectorMathNode } from './VectorMath';
import { registerInputNodes } from './Value';
import { registerMixNode } from './MixColor';
import { registerMapRangeNode } from './MapRange';
import { registerClampNode } from './Clamp';
import { registerCombineSeparateNodes } from './CombineSeparate';
import { registerColorRampNode } from './ColorRamp';
import { registerLogicNodes } from './Logic';
import { registerLayoutNodes } from './Frame';
import { registerGroupNodes } from './Group';
import { registerCurveNodes } from './Curves';

export function registerCommonNodes(): void {
  registerMathNode();
  registerVectorMathNode();
  registerInputNodes();
  registerMixNode();
  registerMapRangeNode();
  registerClampNode();
  registerCombineSeparateNodes();
  registerColorRampNode();
  registerLogicNodes();
  registerLayoutNodes();
  registerGroupNodes();
  registerCurveNodes();
}
