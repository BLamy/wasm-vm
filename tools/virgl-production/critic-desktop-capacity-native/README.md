Independent original-queue resource and context checks for E6-T11d74d2.

Run the selected production boundary with:

```
python3 tools/virgl-production/critic-desktop-capacity-native.py --output target/evidence/critic-desktop-capacity-final
```

The standalone package is outside the repository's Cargo workspace. Its upcoming
512-resource/32-context assertions therefore do not run during an earlier task.
The limits are independent literals from the declared task policy, not imported
from the implementation. Historical private16, desktop64 and context8 guards stay
separate. The exact recorded24×24 resource104 popup is72 original bytes, with an
additional literal fenced-u64 echo check. Every command checks the original used
head, exact response extent and untouched response tail. Control sinks observe
accepted operations; they do not replace the original MMIO/virtqueue transport or
claim to render pixels.

For the preserved original production64 negative baseline only, pass
`--old-production`. That explicit mode expects the old count refusal, proves its
failure atomicity, then unreferences one resource and submits the identical valid
popup. It is not the recurring acceptance for the repaired production profile.
