;; Module with the correct imported-memory shape but no sliced dispatch export.
(module
  (import "env" "memory" (memory 1 2 shared))
)
