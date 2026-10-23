export { Orb, type OrbProps } from "./Orb";
export { OrbShowcase, fakeLevel, type OrbShowcaseProps } from "./OrbShowcase";
export { useAudioLevel, useAudioLevelRef, type AudioLevelOptions } from "./useAudioLevel";
export { useDocumentOrbColor } from "./useDocumentOrbColor";
export { computeRms, rmsToLevel, smoothLevel, frameScaledCoefficient } from "./audioLevelMath";
export { describeOrbState, shortStateLabel, levelSourceFor, tweenTimeConstant, ORB_STATES, ORB_STATE_PARAMS, type OrbVisualParams } from "./orbState";
export { ORB_PALETTES, STATE_TINTS, paletteFor, tintPalette, mixPalette, rgba, swatchColor, resolveOrbColor, isOrbColor, ORB_COLOR_LIST, type OrbPalette, type Rgb } from "./orbPalette";
export { OrbRenderer } from "./orbRenderer";
