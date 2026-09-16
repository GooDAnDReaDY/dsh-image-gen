// Pure helpers for generate_spritesheet (#177) — no cordis/dsh-tools imports.

export const ANIMATION_PRESETS = {
  idle: ['neutral standing pose', 'subtle breathing chest rise', 'slight weight shift', 'return to neutral'],
  walk: ['contact pose left foot forward', 'down pose', 'passing pose', 'up pose', 'contact pose right foot forward', 'down pose', 'passing pose', 'up pose'],
  attack: ['wind-up anticipation', 'strike extension', 'impact frame', 'recoil follow-through'],
  pulse: ['scale 1.0 rest', 'scale 1.08 glow peak', 'scale 1.0 settle', 'scale 0.96 micro-bounce'],
  hover: ['lift 0px', 'lift -6px', 'lift 0px', 'lift 2px press'],
}

export function clampFrames(n) {
  const v = Number(n)
  if (v === 4 || v === 8 || v === 12) return v
  return 8
}

export function buildSpritesheetCss({ frameCount, frameW, frameH, durationSec, name }) {
  const anim = name || 'play'
  const sheetW = frameW * frameCount
  return `/* dsh-image-gen spritesheet */
.${anim} {
  width: ${frameW}px;
  height: ${frameH}px;
  background-image: url('./${anim}-sheet.svg');
  background-repeat: no-repeat;
  background-size: ${sheetW}px ${frameH}px;
  animation: ${anim} ${durationSec}s steps(${frameCount}) infinite;
}
@keyframes ${anim} {
  from { background-position: 0 0; }
  to { background-position: -${sheetW}px 0; }
}
`
}

export function buildSpritesheetSvg(frames, { frameW, frameH }) {
  const count = frames.length
  const totalW = frameW * count
  const totalH = frameH
  let images = ''
  frames.forEach((src, idx) => {
    const b64 = Buffer.isBuffer(src.bytes) ? src.bytes.toString('base64') : Buffer.from(src.bytes).toString('base64')
    const mime = src.mediaType || 'image/png'
    const x = idx * frameW
    images += `<image href="data:${mime};base64,${b64}" x="${x}" y="0" width="${frameW}" height="${frameH}" preserveAspectRatio="xMidYMid slice"/>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">
${images}
</svg>`
}

export function buildFramePrompts(subject, animation, frameCount) {
  const preset = ANIMATION_PRESETS[animation] || ANIMATION_PRESETS.idle
  const phases = []
  for (let i = 0; i < frameCount; i++) {
    phases.push(preset[i % preset.length])
  }
  return phases.map((phase, i) =>
    `2D game sprite frame ${i + 1} of ${frameCount}: ${subject}. Animation phase: ${phase}. `
    + 'Transparent or solid flat background, consistent character scale and camera, same character design across frames, clean silhouette, even lighting.')
}
