# AI Agent Orientation For Move Animation Work

Use this prompt block to orient a fresh agent before asking for custom move animation edits.

```text
You are working in Pokeweb-Serverless move animation tooling.

Core rule:
- Visible battle animation behavior should be implemented through the move animation VM script and SPA assets, not C-side visual injection.

Before editing:
- Resolve donor move ID to the actual animation member/file.
- Decompile the script.
- List referenced SPA IDs, resource IDs, texture IDs, backgrounds, sounds, and camera/sprite commands.
- Preview the donor before changing it.

When copying donor SPAs:
- Do not only swap texture/color.
- Inspect and intentionally keep/remove/replace:
  resource.color
  resource.colorAnim
  resource.alphaAnim
  resource.scaleAnim
  resource.texAnim
  resource.childResource
  resource.behaviors
  resource.startDelayFrames
  resource.baseScale
  resource.aspectRatio
  resource.radius
  resource.length
  resource.emitterBasePos
  resource.initAngle/randomInitAngle/minRotation/maxRotation
  texture RGBA/palette/direct-color data

When describing a plan or final result:
- Separate pure script changes from SPA-required changes.
- Mention any donor commands/sounds/backgrounds intentionally removed.
- Add or update docs when the work teaches a general workflow lesson.
```

## Short Request Template

```text
Create/edit move animation for <move name/id>.

Donors:
- <move id/name>: use <specific part>.
- <move id/name>: use <specific part>.

Desired visual:
- Timeline:
  - frames/time: <effect>
  - frames/time: <effect>
- Particles:
  - texture/color/size/motion expectations
- Sprite/camera/background:
  - user/target movement
  - camera motion
  - background treatment
- Sounds:
  - play/remove/stagger sound IDs

Constraints:
- Use VM script + SPA assets for visible animation.
- Do not globally modify donor SPAs if only this custom move should change.
- Preserve existing donor moves unless explicitly requested.
```

## Local References

- `Pokeweb-Serverless/move-animation-reference/move-animation-reference.md`
- `Pokeweb-Serverless/docs/spa-editing-reference.md`
- `docs/move-animation-workflow-review.md`
- `Pokeweb-Serverless/docs/move-animation-editor/`

