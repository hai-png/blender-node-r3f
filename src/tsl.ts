/**
 * Browser-only sub-entry for TSL features (depends on three/webgpu).
 *
 *   import { TSLShaderEvaluator } from 'blender-nodes-r3f/tsl';
 */
export {
  TSLShaderEvaluator,
  registerEmit,
  type TSLMaterialDescriptor,
  type TSLNode,
} from './eval/tsl/TSLShaderEvaluator';
