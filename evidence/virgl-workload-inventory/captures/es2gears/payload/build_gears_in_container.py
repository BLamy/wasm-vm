#!/usr/bin/env python3
"""Cross-build the unmodified pinned es2gears client from a read-only guest image."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for raw in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(raw)
    return value.hexdigest()


def binding(path, base):
    return {'path': str(path.relative_to(base)), 'bytes': path.stat().st_size, 'sha256': digest(path)}


def require(value, label):
    if not value:
        raise ValueError(label)


def compiler_command(sysroot, upstream, binary, pins):
    """Match upstream's Linux/sincos defines; leave every source body unchanged."""
    libraries = sysroot/'usr/lib'
    return ['riscv64-linux-gnu-gcc','--sysroot='+str(sysroot),'-B'+str(libraries),
            '-std=gnu11','-O2','-DWL_EGL_PLATFORM','-D_GNU_SOURCE','-DHAVE_SINCOS',
            '-Werror=implicit-function-declaration','-Werror=return-type',
            '-Werror=incompatible-pointer-types','-Werror=int-conversion',
            '-fno-math-errno','-fno-trapping-math','-Wl,--build-id=none',
            '-ffile-prefix-map='+str(upstream)+'='+upstream.name,
            '-I'+str(sysroot/'usr/include'),'-I'+str(sysroot/'usr/include/libdecor-0'),
            '-Isrc/egl/eglut','-Isrc/util','-L'+str(libraries),
            '-Wl,-rpath-link,'+str(libraries),*pins['sources'],
            '-lEGL','-lGLESv2','-lwayland-client','-lwayland-egl','-ldecor-0',
            '-lxkbcommon','-lm','-ldl','-pthread','-o',str(binary)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rootfs', required=True, type=Path)
    parser.add_argument('--archive', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    here = Path(__file__).resolve().parent
    base_pins = json.loads((here/'pins.json').read_text())
    pins = json.loads((here/'gears-pins.json').read_text())
    require(os.uname().machine == 'aarch64', 'native ARM64 reference container required')
    require(args.output.is_absolute() and Path('/capture') in args.output.resolve().parents,
            'fresh output must be below the owned /capture directory')
    require(not args.output.exists(), 'refuse to overwrite workload output')
    mounts = []
    for line in Path('/proc/self/mountinfo').read_text().splitlines():
        fields = line.split()
        mount = Path(fields[4].replace('\\040', ' '))
        if args.rootfs == mount or mount in args.rootfs.parents:
            mounts.append((len(str(mount)), fields[5].split(',')))
    require(mounts and 'ro' in max(mounts)[1], 'source rootfs must be read-only')
    require(digest(args.rootfs) == base_pins['source_image_sha256'], 'source rootfs pin')
    require(args.archive.stat().st_size == pins['mesa_demos']['bytes'] and
            digest(args.archive) == pins['mesa_demos']['sha256'], 'original official archive pin')
    packages = {}
    for name, expected in base_pins['cross_packages'].items():
        actual = subprocess.check_output(['dpkg-query','-W','-f=${Version}',name],text=True)
        require(actual == expected, 'cross package differs: '+name)
        packages[name] = actual
    compiler = Path(shutil.which('riscv64-linux-gnu-gcc')).resolve()
    compiler_pin = pins['cross_compiler']
    require(str(compiler)==compiler_pin['path'] and compiler.stat().st_size==compiler_pin['bytes']
            and digest(compiler)==compiler_pin['sha256'],'cross compiler binary pin')
    args.output.mkdir(parents=True)
    sources = args.output/'sources'
    sources.mkdir()
    shutil.copy2(args.archive,sources/pins['mesa_demos']['archive'])
    for name in ('pins.json','gears-pins.json','build_gears_in_container.py'):
        shutil.copy2(here/name,sources/name)
    upstream = sources/('mesa-demos-'+pins['mesa_demos']['version'])
    # Extract only the authenticated source/header/build files, without following
    # archive links or invoking an upstream build system that might fetch inputs.
    with tarfile.open(args.archive) as archive:
        for name in pins['sources']+pins['headers_and_build']:
            require(not Path(name).is_absolute() and '..' not in Path(name).parts,'safe source path')
            member = archive.getmember(upstream.name+'/'+name)
            require(member.isfile(), 'required original source must be a regular file')
            path = upstream/name
            path.parent.mkdir(parents=True,exist_ok=True)
            path.write_bytes(archive.extractfile(member).read())
    sysroot = args.output/'sysroot'
    libraries = sysroot/'usr/lib'
    libraries.mkdir(parents=True)

    def debugfs(command):
        return subprocess.check_output(['debugfs','-R',command,str(args.rootfs)],
                                       stderr=subprocess.DEVNULL,text=True)

    debugfs('rdump /usr/include '+str(sysroot/'usr'))
    for name in ('EGL/egl.h','GLES2/gl2.h','libdecor-0/libdecor.h','wayland-client.h',
                 'wayland-egl.h','xkbcommon/xkbcommon.h'):
        require((sysroot/'usr/include'/name).is_file(),'guest header missing: '+name)
    extracted = set()

    def extract(name):
        if name in extracted:
            return
        require(re.fullmatch(r'[A-Za-z0-9_.+-]+',name), 'safe library name')
        stat = debugfs('stat /usr/lib/'+name)
        require('Inode:' in stat, 'guest library missing: '+name)
        extracted.add(name)
        path = libraries/name
        linked = re.search(r'Fast link dest: "([^"]+)"',stat)
        if linked:
            require('/' not in linked[1] and linked[1] not in ('.','..'),'local library symlink')
            path.symlink_to(linked[1])
            extract(linked[1])
        else:
            debugfs('dump -p /usr/lib/'+name+' '+str(path))
            require(path.is_file() and path.stat().st_size,'guest library extraction failed')
            if path.read_bytes()[:4] == b'\x7fELF':
                dynamic = subprocess.check_output(['riscv64-linux-gnu-readelf','-d',str(path)],text=True)
                for dependency in re.findall(r'\(NEEDED\).*\[([^\]]+)\]',dynamic):
                    extract(dependency)

    for name in ('libEGL.so','libGLESv2.so','libwayland-client.so','libwayland-egl.so',
                 'libdecor-0.so','libxkbcommon.so','libm.so','libdl.a','libpthread.a',
                 'libc.so','libc.so.6','libc_nonshared.a','ld-linux-riscv64-lp64d.so.1',
                 'crt1.o','Scrt1.o','crti.o','crtn.o'):
        extract(name)
    binary = args.output/'bin/es2gears_wayland'
    binary.parent.mkdir()
    command = compiler_command(sysroot,upstream,binary,pins)
    with (args.output/'compile.log').open('w') as log:
        subprocess.run(command,cwd=upstream,stdout=log,stderr=subprocess.STDOUT,check=True)
    header = subprocess.check_output(['riscv64-linux-gnu-readelf','-h',str(binary)],text=True)
    require(re.search(r'Machine:\s+RISC-V',header),'actual RISC-V ELF required')
    (args.output/'elf-header.txt').write_text(header)
    files = [binding(p,sysroot) for p in sorted(sysroot.rglob('*')) if p.is_file()]
    (args.output/'sysroot-files.json').write_text(json.dumps(files,indent=2)+'\n')
    source_files = [binding(upstream/name,upstream) for name in pins['sources']+pins['headers_and_build']]
    manifest = {'schema':'virgl-gears-guest-workload-v1','pins':pins,'basePins':base_pins,
                'invocation':{'rootfs':str(args.rootfs),'archive':str(args.archive),'output':str(args.output)},
                'source_image_sha256':digest(args.rootfs),'crossPackages':packages,
                'compiler':{'path':str(compiler),'bytes':compiler.stat().st_size,'sha256':digest(compiler),
                            'version':subprocess.check_output([str(compiler),'--version'],text=True)},
                'command':{'cwd':str(upstream),'argv':command},'sources':source_files,
                'archive':binding(sources/pins['mesa_demos']['archive'],args.output),
                'binary':binding(binary,args.output),
                'sysrootInventory':binding(args.output/'sysroot-files.json',args.output),
                'compileLog':binding(args.output/'compile.log',args.output),
                'elfHeader':binding(args.output/'elf-header.txt',args.output),
                'builder':binding(sources/'build_gears_in_container.py',args.output)}
    (args.output/'build-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    require(digest(compiler)==compiler_pin['sha256'],'compiler changed during build')
    require(digest(args.rootfs)==base_pins['source_image_sha256'],'source rootfs changed')
    print(json.dumps({'status':'built','output':str(args.output),'binary':manifest['binary']}))


if __name__ == '__main__':
    main()
