# Ordinary arithmetic contract reviewed independently

- Khronos GLSL ES3.00, revision6, section4.5.1, printed page52 (PDF page59): highp division has a 2.5-ULP bound for positive divisors from2^-126 through2^126. Arithmetic zero signs may interchange; subnormals may flush; NaN payload propagation is not required. Normal nonzero divided by zero must have infinity class. Section8.3 defines `fract` using floor and `mix(x,y,a)` using the weighted blend. These guarantee limits are oracle limits, not input-admission gates. Source: https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf
- Pinned `renderer/virgl-shader/vendor/src/vrend/vrend_shader.c`: lines5580–5581 emit LRP as `mix(src2,src1,src0)`; lines5595–5599 emit MAX; lines5702–5704 emit FRC as `fract`; lines5752–5754 emit DIV as `/`. The changed owned emitter preserves these operand roles.
- Mesa26.2.2 TGSI docs (`/tmp/virgl-mesa-26.2.2-tgsi.rst`) at MAX226, LRP281, FRC309 and DIV783 provide the same component equations. The CPU executor is not an authority for stronger all-domain GLSL/IEEE behavior.

No magnitude restriction, nonzero-divisor restriction or [0,1] LRP-weight requirement follows for authorized IN or float-shadow operands. Unknown raw numeric constants remain a separate authority boundary.
