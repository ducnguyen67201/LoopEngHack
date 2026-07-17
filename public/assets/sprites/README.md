# Hire Me If You Can sprite pack

Transparent 8-bit character assets for the recruiting-loop UI. The full sheets are useful for previews; the cropped PNGs are easier to bind directly to event-driven components.

## Event-to-sprite mapping

| Actor | Sprite state | Suggested event cues |
| --- | --- | --- |
| White Researcher | `idle` | waiting, episode initialized |
| White Researcher | `searching` | Zero capability search started, profile enrichment requested |
| White Researcher | `verifying` | claim verification or evidence comparison started |
| White Researcher | `success` | verified evidence stored, legitimate candidate cleared |
| Red Social Engineer | `idle` | synthetic candidate waiting |
| Red Social Engineer | `messaging` | outreach reply or manipulation attempt composed |
| Red Social Engineer | `bluffing` | unsupported authority or credential claim submitted |
| Red Social Engineer | `blocked` | Pomerium denied a privileged action or replay defense fired |

The four recruit images are synthetic profile avatars. Their appearance is presentation-only and must never become evidence, a ranking signal, or a hiring feature.

## Browser rendering

Use the cropped PNGs as normal image sources and preserve the pixel edges:

```css
.game-sprite {
  width: 128px;
  height: auto;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
}
```

Use `manifest.json` as the stable lookup contract. The engine should emit semantic visual cues such as `researcher.searching`; the UI resolves those cues to files without putting workflow state in the browser.
