set -euo pipefail
cd "$HOME/chromium-smoke/replay-chromium"
if [ -f ../gui-browser.pid ]; then
  old=$(cat ../gui-browser.pid)
  kill "$old" 2>/dev/null || true
  for attempt in $(seq 1 30); do kill -0 "$old" 2>/dev/null || break; sleep .2; done
fi
exec 3<>/dev/tcp/10.0.2.2/8530
printf 'GET /build20/chrome HTTP/1.0\r\nHost: localhost\r\n\r\n' >&3
IFS= read -r response <&3
[[ "$response" == *' 200 '* ]]
while IFS= read -r header <&3; do [ "$header" = $'\r' ] && break; done
cat <&3 > chrome.new
exec 3<&-
chmod +x chrome.new
sha256sum chrome.new
mv chrome.new chrome
bash /tmp/replay-73081db4c75a47bdabc0ee59b2ae43bc.sh
sleep 5
printf 'GUI_ERRORS_BEGIN\n'
grep -E 'FATAL|ERROR|SIG|Crash' ../gui-browser.log | tail -12 || true
printf 'GUI_ERRORS_END\n'
