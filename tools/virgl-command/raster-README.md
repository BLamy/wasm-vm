`make verify-E6-T12h` replays the complete first kmscube (six draws) and es2gears
(three draws) client submissions with immutable CPU backing snapshots. Independent
wire/state observations bind their real shader reflection, complete VS constant
banks, RGB32F/RG32F fetches, triangle strips, negative-Y viewports and native Z16
depth attachment. Readback digests record those draws; this is not a claim about
live guest execution, completed client artwork or frame rate.

Separate literal pixel scenes prove GL clip depth at z=±0.999 against a drawn
mid-depth occluder, eight depth comparisons, depth-write masks, full color/depth
clears, lower-left scissor, asymmetric orientation and Gallium winding. A/B/A
contexts with poisoned GL state preserve exact pixels and retained depth objects
survive public name/ID reuse. Owned nonindexed jobs use the existing completion
fence and require no GPU index readback. Varied delays 0/1/3 exercise later-task
pumping and the final fence. Five served runtime mutations must fail named
physical pixel predictions, never an unrelated exception.

The pinned virglrenderer 1.3.0 commit `ca50e008863837e094747a69974dde3ae148aeaa`
provides the coordinate/state convention in `src/vrend/vrend_renderer.c`:
`vrend_set_viewport_states` / `vrend_update_viewport_state` use
`translateY - abs(scaleY)` and `2 * abs(scaleY)`, with `winsys_adjust_y = -1` for
negative scaleY. DepthRange remains translateZ ± scaleZ and shader clip Z remains
GL [-1,1]. Lower-left flags0 invert Gallium front_ccw. `vrend_clear` ignores
scissor and component/depth write masks before restoring the draw state.
The raster bottom-edge field is preserved; Gallium has already accounted for it
in the GL coordinate convention (pinned rasterizer clip-control branch).

Only per-vertex float RG/RGB fetches, TRIANGLES/TRIANGLE_STRIP, one instance,
no restart and normalized Z16 are admitted. Stencil storage/testing, alpha test,
points/lines, other formats, negative X scale and base/instance/restart variants
remain explicit errors. Indexed start remains zero; nonindexed start/count must
fit signed GL integers and actual complete vertex storage. Wire min/max hints
never authorize fetches. Existing budgets charge both draw families together.

Depth, blend, scissor, viewport/Y sign, culling, constants and vertex layouts do
not alter emitted shaders: complete state is restored before each draw, and Y
sign updates the owned system block. Shader keys therefore retain selector
generations, exact interface/coordinate/discard contracts and used view format,
target/level/layer/origin/swizzles. The next cache task owns broader cache keys,
budgets and eviction. This layer advertises no production capset.

All affected tiny-scene/resource/state/indexed/async/color/depth/view/inline
regressions run on the current source. Freeze before the final run, execute
`python3 tools/virgl-command/raster-cold.py --output OUTPUT` once, then seal with
`python3 tools/virgl-command/raster-seal.py HOT COLD OUTPUT` and hand the diff,
claim and records to a fresh adversarial verifier.
