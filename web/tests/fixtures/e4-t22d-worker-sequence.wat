;; Deterministic E4-T22d worker fixture.
;; 1st run_slice: writes a marker through the imported memory and continues.
;; 2nd run_slice: requests WFI with a one-second deadline.
;; 3rd run_slice: halts after the host raises an IRQ.
(module
  (import "env" "memory" (memory 1 2 shared))
  (global $phase (mut i32) (i32.const 0))

  (func (export "run_slice") (result i32)
    (global.get $phase)
    (i32.const 1)
    (i32.add)
    (global.set $phase)

    (global.get $phase)
    (i32.const 1)
    (i32.eq)
    (if
      (then
        (i32.const 0)
        (i32.const 0x22)
        (i32.store)
        (i32.const 0)
        (return)
      )
    )

    (global.get $phase)
    (i32.const 2)
    (i32.eq)
    (if
      (then
        (i32.const 1000)
        (return)
      )
    )

    (global.get $phase)
    (i32.const 3)
    (i32.eq)
    (if
      (then
        (i32.const 1000)
        (return)
      )
    )

    (i32.const -1)
  )
)
