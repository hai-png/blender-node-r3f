export * from './Shaders';
export * from './BSDFs';
export * from './Textures';
export * from './Inputs';
export * from './VectorOps';

import { registerCoreShaderNodes } from './Shaders';
import { registerBsdfNodes } from './BSDFs';
import { registerShaderTextures } from './Textures';
import { registerShaderInputs } from './Inputs';
import { registerShaderVectorOps } from './VectorOps';

/**
 * Registers the full M1 shader node pack — Output + BSDFs + textures
 * + inputs + vector ops.
 */
export function registerShaderNodes(): void {
  registerCoreShaderNodes();
  registerBsdfNodes();
  registerShaderTextures();
  registerShaderInputs();
  registerShaderVectorOps();
}
