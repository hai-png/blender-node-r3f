export * from './Compositor';
export * from './MoreCompositor';

import { registerCompositorNodes as _registerCore } from './Compositor';
import { registerMoreCompositorNodes } from './MoreCompositor';

/** Registers the full compositor node pack (core + Phase-3 audit additions). */
export function registerCompositorNodes(): void {
  _registerCore();
  registerMoreCompositorNodes();
}
