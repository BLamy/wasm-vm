#!/usr/bin/env bash
set -euo pipefail
cd /work/src
export PATH="/work/tools/depot_tools/.cipd_bin/3.8/bin:/work/tools/depot_tools:$PATH"
export DEPOT_TOOLS_UPDATE=0 DEPOT_TOOLS_METRICS=0
python3 -m pip install --disable-pip-version-check httplib2==0.19.1 six==1.15.0 pyparsing==2.4.7 protobuf==3.20.0
python3 build/util/lastchange.py -o build/util/LASTCHANGE
python3 build/util/lastchange.py -m GPU_LISTS_VERSION --revision-id-only --header gpu/config/gpu_lists_version.h
python3 build/util/lastchange.py -m SKIA_COMMIT_HASH -s third_party/skia --header skia/ext/skia_commit_hash.h
python3 build/util/lastchange.py -s third_party/dawn --revision gpu/webgpu/DAWN_VERSION
python3 third_party/depot_tools/download_from_google_storage.py --no_resume --extract --no_auth --bucket chromium-nodejs -s third_party/node/node_modules.tar.gz.sha1
cd /work/tools
if [ ! -f node-v16.13.0-linux-arm64.tar.xz ]; then
  curl -fL --retry 3 https://nodejs.org/dist/v16.13.0/node-v16.13.0-linux-arm64.tar.xz -o node-v16.13.0-linux-arm64.tar.xz
fi
curl -fL --retry 3 https://nodejs.org/dist/v16.13.0/SHASUMS256.txt -o node-v16.13.0-SHASUMS256.txt
grep " node-v16.13.0-linux-arm64.tar.xz$" node-v16.13.0-SHASUMS256.txt | sha256sum -c -
# Only the Node executable is used. Extracting just it also avoids host mount
# restrictions on the npm/npx symlinks in the full distribution.
tar -xJf node-v16.13.0-linux-arm64.tar.xz node-v16.13.0-linux-arm64/bin/node
mkdir -p /work/src/third_party/node/linux/node-linux-x64/bin
cp -f node-v16.13.0-linux-arm64/bin/node /work/src/third_party/node/linux/node-linux-x64/bin/node
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends openjdk-17-jre-headless
chmod u+w /work/src/third_party/jdk/current/bin/java
cat > /work/src/third_party/jdk/current/bin/java <<'JAVA_LAUNCHER'
#!/usr/bin/env bash
exec /usr/lib/jvm/java-17-openjdk-arm64/bin/java "$@"
JAVA_LAUNCHER
chmod 755 /work/src/third_party/jdk/current/bin/java
/work/src/third_party/node/linux/node-linux-x64/bin/node --version
/work/src/third_party/jdk/current/bin/java -version
python3 /work/prepare-unbundled-driver.py
