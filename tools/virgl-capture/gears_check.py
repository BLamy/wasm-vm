#!/usr/bin/env python3
"""Authenticate an unchanged Mesa demos client and its real guest completion.

No GL_RENDERER line is fabricated: Mesa demos -info prints EGL information.
The inventory separately demands successful DRAW_VBO packets from the exact
live client context, with its original uploaded shaders and resource backings.
"""
import importlib.util
import io
from pathlib import Path
import re
import struct
import tarfile
from types import SimpleNamespace

from validate import ROOT, load_json, require, sha256, uint
from capture import guest_script_text


def module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def check_gears(manifest, artifacts):
    pins_path = ROOT/'tools/virgl-capture/workloads/gears-pins.json'
    pins = load_json(pins_path.read_bytes())
    base_pins = load_json((pins_path.parent/'pins.json').read_bytes())
    require(manifest['workload']=='es2gears' and manifest['result'].get('workloadPass') is True,
            'actual gears workload result failed')
    required = {'gears-build-manifest.json','gears-sysroot-files.json','gears-compile.log',
                'gears-elf-header.txt','gears-pins.json','build_gears_in_container.py',
                pins['mesa_demos']['archive'],'es2gears_wayland','gears-control.log',
                'gears-clients.json','gears-close.log','gears-window-setup.log','gears-executable.txt',
                'gears-executable.sha256','gears-library-maps.txt','gears-library-hashes.txt',
                'gears-comm.txt','gears-environ.bin','gears-fds.txt','gears-drm-driver.txt',
                'input-setup.log','udev.log','hyprland.log','hyprctl-exit.log'}
    require(required <= artifacts.keys(),'missing unchanged gears provenance artifact')
    require(artifacts['gears-pins.json']==pins_path.read_bytes(),'gears source pin substituted')
    builder_path = pins_path.parent/'build_gears_in_container.py'
    require(artifacts['build_gears_in_container.py']==builder_path.read_bytes(),'gears builder source substituted')
    build = load_json(artifacts['gears-build-manifest.json'])
    require(build.get('schema')=='virgl-gears-guest-workload-v1' and build.get('pins')==pins
            and build.get('basePins')==base_pins and build.get('source_image_sha256')==base_pins['source_image_sha256']
            and build.get('crossPackages')==base_pins['cross_packages'],'gears build/source/toolchain pins differ')
    invocation = build.get('invocation',{})
    require(set(invocation)=={'rootfs','archive','output'} and invocation['rootfs']=='/reference/omarchy.ext4'
            and invocation['archive']=='/workload-build/inputs/'+pins['mesa_demos']['archive'],
            'gears builder invocation differs')
    output = Path(invocation['output'])
    require(output.is_absolute() and '..' not in output.parts and Path('/capture') in output.parents,
            'unsafe gears build directory')
    upstream = output/'sources'/('mesa-demos-'+pins['mesa_demos']['version'])
    builder = module(builder_path,'gears_builder_for_check')
    require(build.get('command')=={'cwd':str(upstream),
             'argv':builder.compiler_command(output/'sysroot',upstream,output/'bin/es2gears_wayland',pins)},
            'unmodified gears compile command differs')
    compiler = build.get('compiler',{})
    compiler_pin = pins['cross_compiler']
    require(compiler.get('path')==compiler_pin['path'] and compiler.get('sha256')==compiler_pin['sha256']
            and uint(compiler.get('bytes'),'compiler bytes')==compiler_pin['bytes']
            and compiler.get('version','').startswith(compiler_pin['version_prefix']),
            'unexpected actual cross compiler identity')

    def bound(key, name, original_path):
        ref = build.get(key,{})
        data = artifacts[name]
        require(ref.get('path')==original_path and uint(ref.get('bytes'),key+' bytes')==len(data)
                and ref.get('sha256')==sha256(data),'gears build binding differs: '+key)
        return data

    original_archive = bound('archive',pins['mesa_demos']['archive'],'sources/'+pins['mesa_demos']['archive'])
    require(len(original_archive)==pins['mesa_demos']['bytes'] and sha256(original_archive)==pins['mesa_demos']['sha256'],
            'original official Mesa demos archive pin differs')
    source_bindings = []
    with tarfile.open(fileobj=io.BytesIO(original_archive)) as archive:
        for name in pins['sources']+pins['headers_and_build']:
            member = archive.getmember(upstream.name+'/'+name)
            require(member.isfile(),'required original source is not a regular file')
            raw = archive.extractfile(member).read()
            source_bindings.append({'path':name,'bytes':len(raw),'sha256':sha256(raw)})
    require(build.get('sources')==source_bindings,'original source/header/build bytes differ')
    bound('builder','build_gears_in_container.py','sources/build_gears_in_container.py')
    bound('compileLog','gears-compile.log','compile.log')
    header = bound('elfHeader','gears-elf-header.txt','elf-header.txt').decode()
    require(re.search(r'Machine:\s+RISC-V',header),'captured ELF header is not RISC-V')
    binary = bound('binary','es2gears_wayland','bin/es2gears_wayland')
    require(len(binary)>64 and binary[:6]==b'\x7fELF\x02\x01' and struct.unpack_from('<H',binary,18)[0]==243,
            'actual gears executable is not little-endian ELF64 RISC-V')
    sysroot = load_json(bound('sysrootInventory','gears-sysroot-files.json','sysroot-files.json'))
    require(isinstance(sysroot,list) and len(sysroot)>100,'missing actual guest sysroot inventory')
    files = {}
    for ref in sysroot:
        name = ref.get('path','')
        require(isinstance(name,str) and name.startswith('usr/') and '..' not in Path(name).parts
                and name not in files and re.fullmatch(r'[0-9a-f]{64}',ref.get('sha256','')),
                'unsafe/duplicate sysroot binding')
        uint(ref.get('bytes'),'sysroot bytes')
        files[name] = ref
    for name in ('EGL/egl.h','GLES2/gl2.h','wayland-client.h','wayland-egl.h',
                 'xkbcommon/xkbcommon.h','libdecor-0/libdecor.h'):
        require('usr/include/'+name in files,'missing required guest header')

    command = manifest['command']
    parameters = command.get('guestWorkload',{})
    require(parameters=={'workload':'es2gears','outputDirectory':parameters.get('outputDirectory'),
                         'gearsDirectory':str(output)},'gears launch points at a different build')
    capture_output = Path(parameters['outputDirectory'])
    require(capture_output.is_absolute() and '..' not in capture_output.parts and Path('/capture') in capture_output.parents,
            'unsafe captured guest output')
    guest_output = '/hostcapture/'+str(capture_output.relative_to('/capture'))
    args = SimpleNamespace(workload='es2gears',gears_directory=str(output))
    require(artifacts['guest.sh']==guest_script_text(args,guest_output).encode(),
            'guest driver differs from current source; forged exit/renderer/FPS marker or early closure')
    argv = command['argv']
    inputs = {ref['role']:ref for ref in manifest['inputs']}
    require(inputs['rootfs']['sourcePath']==invocation['rootfs'],'build and guest images differ')
    require(argv==['qemu-system-riscv64','-machine','virt','-accel','tcg','-cpu','rv64',
                  '-smp','4','-m','2048','-global','virtio-mmio.force-legacy=false','-bios','default',
                  '-kernel',inputs['kernel']['sourcePath'],'-append',
                  'root=/dev/vda rw console=ttyS0 init=/bin/bash','-drive',
                  f'file={capture_output}/overlay.qcow2,format=qcow2,if=none,id=root',
                  '-device','virtio-blk-device,drive=root','-device','virtio-gpu-gl-device',
                  '-device','virtio-keyboard-device','-device','virtio-tablet-device',
                  '-fsdev','local,id=capture,path=/capture,security_model=none','-device',
                  'virtio-9p-device,fsdev=capture,mount_tag=capture','-display',
                  'gtk,gl=on,show-cursor=on','-serial',
                  f'unix:{capture_output}/serial.sock,server=on,wait=on','-monitor','none','-no-reboot'],
            'actual reference guest launch differs')
    environment = command['env']
    renderer_dir = str(Path(inputs['hostRenderer']['sourcePath']).parent)
    require(environment=={'PATH':'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
                          'HOME':'/root','LANG':'C.UTF-8','MESA_SHADER_CACHE_DISABLE':'true',
                          'DISPLAY':':1','LIBGL_ALWAYS_SOFTWARE':'1','GALLIUM_DRIVER':'llvmpipe',
                          'LD_LIBRARY_PATH':renderer_dir,'LD_PRELOAD':inputs['recorder']['sourcePath'],
                          'VIRGL_CAPTURE_REAL_LIBRARY':renderer_dir+'/libvirglrenderer.so.1',
                          'VIRGL_CAPTURE_DIR':str(capture_output),'VIRGL_CAPTURE_WORKLOAD':'es2gears',
                          'VIRGL_CAPTURE_MAX_EVENTS':str(manifest['limits']['events']),
                          'VIRGL_CAPTURE_MAX_BLOB_BYTES':str(manifest['limits']['blobBytes']),
                          'VIRGL_CAPTURE_MAX_EVENT_BYTES':str(manifest['limits']['eventBytes'])},
            'actual host recording environment differs')
    process_environment = {}
    require(artifacts['gears-environ.bin'].endswith(b'\0'),'truncated client environment')
    for entry in artifacts['gears-environ.bin'].split(b'\0')[:-1]:
        name,sep,value = entry.partition(b'=')
        require(sep and name not in process_environment,'malformed/duplicate client environment')
        process_environment[name] = value
    require(not ({b'LIBGL_ALWAYS_SOFTWARE',b'GALLIUM_DRIVER',b'LP_NUM_THREADS',
                  b'MESA_LOADER_DRIVER_OVERRIDE',b'MESA_NO_ERROR'} & process_environment.keys())
            and process_environment.get(b'MESA_SHADER_CACHE_DISABLE')==b'true'
            and process_environment.get(b'LD_PRELOAD')==b'/usr/lib/coreutils/libstdbuf.so',
            'guest client environment selects a substituted/fallback renderer')
    require(artifacts['gears-comm.txt']==b'es2gears_waylan\n','actual client comm differs')
    require(artifacts['gears-executable.txt']==('/hostcapture/'+str(output.relative_to('/capture'))+
             '/bin/es2gears_wayland\n').encode(),'actual running executable path differs')
    control = {}
    for line in artifacts['gears-control.log'].decode().splitlines():
        key,sep,value = line.partition('=')
        require(sep and key not in control,'duplicate/malformed client control result')
        control[key] = value
    require(set(control)=={'pid','address','rendered','resized','window-close','client-exit','identity'}
            and all(control[k]=='1' for k in ('rendered','resized','identity'))
            and control['window-close']=='0' and control['client-exit']=='0'
            and re.fullmatch(r'[1-9][0-9]*',control['pid']) and re.fullmatch(r'0x[0-9a-f]+',control['address']),
            'original client did not exit zero after normal IPC closure')
    pid = int(control['pid'])
    require(artifacts['gears-executable.sha256']==f'{sha256(binary)}  /proc/{pid}/exe\n'.encode(),
            'executed binary differs from unchanged cross-build')
    clients = load_json(artifacts['gears-clients.json'])
    require(isinstance(clients,list),'client IPC response is not a list')
    matches = [c for c in clients if c.get('pid')==pid and c.get('title')=='es2gears']
    require(len(matches)==1 and type(matches[0]['pid']) is int
            and matches[0].get('address')==control['address'] and matches[0].get('size')==[300,300]
            and matches[0].get('floating') is True,'closed window is not the actual unchanged gears client')
    require(artifacts['gears-close.log']==b'ok\n' and artifacts['gears-window-setup.log']==b'ok\nok\n'
            and artifacts['hyprctl-exit.log']==b'ok\n','compositor IPC did not succeed')
    require(artifacts['input-setup.log'].startswith(b'coldplug=1\n')
            and b'ID_INPUT_KEYBOARD=1\n' in artifacts['input-setup.log'],'real guest input coldplug failed')
    require(artifacts['gears-drm-driver.txt']==b'/sys/bus/virtio/drivers/virtio_gpu\n'
            and re.search(rf'^/proc/{pid}/fd/[0-9]+ /dev/dri/renderD128$',artifacts['gears-fds.txt'].decode(),re.M),
            'actual client did not hold the VirtIO render node')
    maps = artifacts['gears-library-maps.txt'].decode()
    mapped = set(re.findall(r'^.*\s(/usr/lib/[^\n ]*\.so[^\n ]*)$',maps,re.M))
    hashes = {}
    for line in artifacts['gears-library-hashes.txt'].decode().splitlines():
        match = re.fullmatch(r'([0-9a-f]{64})  (/usr/lib/[^ ]+)',line)
        require(match and match[2] not in hashes,'malformed/duplicate mapped-library digest')
        hashes[match[2]] = match[1]
    require(hashes.keys()==mapped,'actual mapped-library digest coverage differs')
    for path,value in hashes.items():
        if path[1:] in files:
            require(files[path[1:]]['sha256']==value,'linked guest library differs from runtime: '+path)
    primary = dict((path,value) for value,path in
                   (line.split(maxsplit=1) for line in artifacts['guest-libraries.sha256'].decode().splitlines()))
    gallium = [path for path in mapped if path.startswith('/usr/lib/libgallium-')]
    require(len(gallium)==1 and primary.get(gallium[0])==hashes[gallium[0]],
            'actual Gallium library differs from immutable guest library')
    require(re.search(r'(?m)^.*Renderer: virgl\b',artifacts['hyprland.log'].decode()),
            'supporting compositor did not use real guest VirGL')
    reports = re.findall(r'(?m)^([1-9][0-9]*) frames in\s+([0-9]+\.[0-9]) seconds =\s+([0-9]+\.[0-9]{3}) FPS$',
                         artifacts['workload.log'].decode())
    require(reports and all(float(seconds)>=5.0 and float(fps)>0 for _,seconds,fps in reports),
            'unchanged original client did not reach its positive first five-second report')
    return {'binarySha256':sha256(binary),'sourceArchiveSha256':sha256(original_archive),
            'sourceFiles':source_bindings,'pid':pid,'comm':'es2gears_waylan','normalExit':0,
            'sourceReportedFrames':[int(frames) for frames,_,_ in reports],
            'boundary':'Original idle-loop report is a completion marker, never a GPU/MIPS benchmark.',
            'mappedLibraryCount':len(mapped),'galliumSha256':hashes[gallium[0]]}
