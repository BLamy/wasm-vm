set -euo pipefail
cd "$HOME/chromium-smoke/replay-chromium"
exec 3<>/dev/tcp/10.0.2.2/8530
printf 'GET /build20/sandbox_linux_unittests HTTP/1.0\r\nHost: localhost\r\n\r\n' >&3
IFS= read -r response <&3
[[ "$response" == *' 200 '* ]]
while IFS= read -r header <&3; do [ "$header" = $'\r' ] && break; done
cat <&3 > sandbox_linux_unittests.new
exec 3<&-
chmod +x sandbox_linux_unittests.new
sha256sum sandbox_linux_unittests.new
mv sandbox_linux_unittests.new sandbox_linux_unittests
ulimit -c 0
export RECORD_REPLAY_DONT_RECORD=1
timeout 600 ./sandbox_linux_unittests --gtest_color=no --test-launcher-jobs=1 --test-launcher-retry-limit=0 > ../sandbox-tests-build20.log 2>&1
result=$?
tail -14 ../sandbox-tests-build20.log
exit "$result"
