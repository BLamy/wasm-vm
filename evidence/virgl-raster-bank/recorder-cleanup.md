The final worker command paused in recorder teardown after the retained radial
report, screenshot and coverage had already completed. An idle Node sample and
read-only inspector queries identified the open stderr socket: it was inherited
by the recorded Chrome launch's crashpad and updater processes. The socket
closed naturally before a cleanup action could run. No process was killed and
no recorded result or runtime state was changed. The command resumed and exited
zero. Its full acceptance log preserves the inspector diagnostics. The scrubbed
pristine-clone command passed normally, with a clean checkout before and after.
