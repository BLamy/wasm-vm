;; A non-blocking fixture used to deliver a duplicate boot while the first dispatch loop is alive.
(module
  (import "env" "memory" (memory 1 2 shared))
  (func (export "run_slice") (result i32)
    (i32.const 0)
  )
)
