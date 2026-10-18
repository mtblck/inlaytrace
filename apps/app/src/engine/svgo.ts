/**
 * The one SVGO configuration, for the export, the numbers shown and the
 * target-size search, so all three agree. Groups (#41) are kept: their ids
 * aren't referenced, so SVGO's defaults would drop the ids and then the
 * groups themselves.
 */
import type { Config } from 'svgo/browser'

export const SVGO: Config = {
  multipass: true,
  floatPrecision: 2,
  plugins: [{ name: 'preset-default', params: { overrides: { cleanupIds: false } } }],
}
