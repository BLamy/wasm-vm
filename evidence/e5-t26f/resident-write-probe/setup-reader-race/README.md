Failed first measurement: the probe did not wait until its real cat reader opened
the FIFO. The parent fed and closed before the child open, leaving cat blocked
in open and zero captured FIFO output. These incomplete traces are not accepted
FIFO measurements. The corrected probe waits for actual pipe_read before feed,
matching the resident helper's prepared-reader boundary. No runtime bug is claimed.
