#!/usr/bin/env python3
"""Native recorder contract evidence; explicit fake ABI renderer, never GPU proof."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import uuid

PIN = "ca50e008863837e094747a69974dde3ae148aeaa"


def require(value, message):
    if not value:
        raise RuntimeError(message)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def check_happy(events, blob):
    expected = [
        ("create", [3, 5], b"abcDEFGH"),
        ("transfer_before", [4, 4], b"ijklMNOP"),
        ("transfer_before", [3, 5], b"abcDEFGH"),
        ("transfer_before", [4, 4], b"writeOUT"),
        ("transfer_after", [4, 4], b"readAFT0"),
        ("transfer_before", [3, 5], b"writeOUT"),
        ("transfer_after", [3, 5], b"readAFT0"),
        ("submit", [3, 5], b"readAFT0"),
        ("attach", [3, 5], b"REATTACH"),
        ("submit", [3, 5], b"REATTACH"),
        ("create", [3, 5], b"REUSED!!"),
        ("submit", [3, 5], b"REUSED!!"),
        ("create", [3, 5], b"RESETNEW"),
        ("submit", [3, 5], b"RESETNEW"),
    ]
    snapshots = [e for e in events if e["type"] == "backing_snapshot"]
    actual = [(e["reason"], e["iovLengths"], blob(e["blobs"][0])) for e in snapshots]
    require(actual == expected, "independent snapshot bytes/order/IOV boundaries differ")
    require(all(e["resourceId"] == 7 for e in snapshots), "snapshot resource identity differs")
    enters = [e for e in events if e.get("phase") == "enter"]
    transfers = [e for e in enters if e["type"].startswith("transfer_")]
    require([e["explicitIov"] for e in transfers] == [True, False, True, False], "transfer branch coverage differs")
    for e in transfers:
        require(all(e[k] == v for k, v in {"resourceId":7,"ctxId":19,"level":2,"stride":97,"layerStride":997,
                "offset":0x1234567887654321,"iovCount":2 if e["explicitIov"] else 0,
                "box":{"x":1,"y":2,"z":3,"w":4,"h":5,"d":6}}.items()), "transfer scalar forwarding differs")
    submissions = [e for e in enters if e["type"] == "submit_cmd"]
    require(len(submissions) == 6, "submit lifecycle coverage differs")
    require([events[e["seq"]-2]["type"] == "backing_snapshot" for e in submissions] ==
            [True,False,True,True,False,True], "detached/reset resource leaked into snapshots")
    require(all(blob(e["blobs"][0]) == bytes.fromhex("12345678fedcba98") for e in submissions), "submitted bytes changed")
    for e in enters:
        if e["type"] in ("context_create", "context_create_with_flags"):
            require(blob(e["blobs"][0]) == b'm\0"\\\xff', "context name not byte exact")
    returns = [e for e in events if e.get("phase") == "return"]
    result_codes = {"transfer_write_iov":-17,"transfer_read_iov":-19,"submit_cmd":37,
                    "context_create":47,"context_create_with_flags":49,"create_fence":41,"context_create_fence":43}
    for e in returns:
        require(e["result"] == result_codes.get(e["type"], 0), "API result changed")
        if e["type"] == "fill_caps":
            require(blob(e["blobs"][0]) == b"CAPS\0\x7f\x80\xff", "capset output not captured after return")
    resources = [e for e in enters if e["type"] == "resource_create"]
    require(len(resources) == 3, "resource reuse coverage differs")
    for e in resources:
        require(all(e[k] == v for k,v in {"resourceId":7,"target":2,"format":67,"bind":8,"width":17,"height":19,
                "depth":1,"arraySize":1,"lastLevel":2,"nrSamples":4,"flags":3,"iovCount":2}.items()), "resource descriptor changed")
    require(events[-1]["cleanupSeen"] is True, "cleanup footer missing")


def check_callbacks(events, version):
    legacy = [e for e in events if e["type"] == "write_fence" and e.get("phase") == "enter"]
    contexts = [e for e in events if e["type"] == "write_context_fence" and e.get("phase") == "enter"]
    require(len(legacy) == 1 and legacy[0]["fenceId"] == 0xfedcba98, "legacy callback lost or changed")
    require(len(contexts) == (1 if version >= 3 else 0), "callback ABI version handling differs")
    for e in legacy + contexts:
        parent = events[e["parentCallSeq"]-1]
        require(parent["type"] == ("create_fence" if e["type"] == "write_fence" else "context_create_fence"), "callback nesting lost")
    if contexts:
        require(all(contexts[0][k] == v for k,v in {"ctxId":19,"ringId":3,"fenceId":0xfedcba9876543210}.items()), "64-bit context fence changed")


def inside(args):
    inputs, output = args.inputs.resolve(), args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    commands = []
    def command(argv, **kwargs):
        commands.append({"argv":list(map(str, argv)), "env":kwargs.get("env", {})})
        result = subprocess.run(argv, cwd=output, capture_output=True, text=True, timeout=30, **kwargs)
        return result
    common = ["cc", "-std=gnu11", "-O2", "-g", "-Wall", "-Wextra", "-Werror", "-I", str(inputs/"abi")]
    build_commands = [
        common + ["-fPIC","-shared","-DRECORDER_FAKE",str(inputs/"recorder_contract.c"),"-o",str(output/"librecorder_fake.so")],
        common + ["-fPIC","-shared",str(inputs/"recorder.c"),"-o",str(output/"recorder.so"),"-lcrypto","-ldl","-pthread"],
        common + [str(inputs/"recorder_contract.c"),"-L",str(output),"-lrecorder_fake","-Wl,-rpath,$ORIGIN","-o",str(output/"recorder_driver")],
    ]
    for i, argv in enumerate(build_commands):
        result = command(argv)
        (output/f"compile-{i}.log").write_text(result.stdout+result.stderr)
        require(result.returncode == 0, f"compile {i} failed: {result.stderr}")
    report = {"schema":"virgl-recorder-contract-v1", "boundary":"fake public ABI renderer; no renderer, GPU, guest, or concurrency semantics proven",
              "virglCommit":PIN,"cases":[],"compiler":command(["cc","--version"]).stdout,
              "inputs":{str(p.relative_to(inputs)):digest(p) for p in sorted(inputs.rglob("*")) if p.is_file()}}
    def case(name, scenario, overrides=None, reason=None):
        directory = output/name; directory.mkdir()
        env = {"PATH":"/usr/bin:/bin", "LD_PRELOAD":str(output/"recorder.so"),
               "VIRGL_CAPTURE_REAL_LIBRARY":str(output/"librecorder_fake.so"),"VIRGL_CAPTURE_DIR":str(directory),
               "VIRGL_CAPTURE_WORKLOAD":"textured-scene"}
        env.update(overrides or {})
        result = command([str(output/"recorder_driver"), scenario], env=env)
        (directory/"stdout.log").write_text(result.stdout);(directory/"stderr.log").write_text(result.stderr)
        require(result.returncode == 0, f"{name}: driver failed {result.returncode}: {result.stderr}")
        require("HARNESS_FORWARDING_PASS" in result.stdout or scenario=="active-exit", f"{name}: missing independent forwarding assertions")
        raw = (directory/"events.jsonl").read_bytes()
        events = [json.loads(line) for line in raw.splitlines()]
        require(raw.endswith(b"\n") and events[-1]["type"]=="end", f"{name}: incomplete footer")
        require([e["seq"] for e in events] == list(range(1,len(events)+1)), f"{name}: sequence changed")
        failed=(directory/"FAILED").exists()
        require(failed == (reason is not None) and events[-1]["complete"] == (reason is None), f"{name}: fail-closed outcome differs")
        if reason:
            require(reason in (directory/"FAILED").read_text(), f"{name}: wrong failure reason")
        def blob(ref):
            data=(directory/"blobs"/(ref["sha256"]+".bin")).read_bytes()
            require(len(data)==ref["bytes"] and hashlib.sha256(data).hexdigest()==ref["sha256"], f"{name}: blob integrity failed")
            return data
        for event in events:
            for ref in event["blobs"]: blob(ref)
        if not reason:
            calls={}
            for event in events:
                if event.get("phase")=="enter":
                    parent=event["parentCallSeq"]
                    require(event["threadId"]==1 and (parent==0 or parent in calls), f"{name}: invalid call nesting")
                    calls[event["seq"]]=event
                elif event.get("phase")=="return":
                    call=calls.pop(event["callSeq"])
                    require(call["type"]==event["type"] and call["threadId"]==event["threadId"], f"{name}: invalid return pairing")
            require(not calls and events[-1]["openCalls"]==0, f"{name}: open calls")
        if scenario=="happy": check_happy(events,blob);check_callbacks(events,4)
        if scenario.startswith("callbacks-"): check_callbacks(events,int(scenario[-1]))
        report["cases"].append({"name":name,"scenario":scenario,"passed":True,"expectedFailure":reason,
                                 "events":len(events),"eventBytes":len(raw),"eventSha256":hashlib.sha256(raw).hexdigest(),"commandIndex":len(commands)-1})
        return raw
    try:
        case("happy","happy")
        for version in range(1,5):case(f"callbacks-{version}",f"callbacks-{version}")
        case("callback-invalid","callback-invalid",reason="unsupported callback version")
        case("callback-null","callback-null",reason="unsupported callback version")
        case("unsupported-blob","blob",reason="blob resources are outside capture profile")
        case("iov-count","iov-count",reason="backing snapshot failed")
        case("iov-size","iov-size",reason="backing snapshot failed")
        case("iov-null","iov-null",reason="backing snapshot failed")
        case("iov-array-null","iov-array-null",reason="backing snapshot failed")
        for scenario in ("submit-negative","submit-large","submit-null"):
            case(scenario,scenario,reason="submit capture failed")
        case("resource-limit","resource-limit",reason="resource table full")
        case("active-exit","active-exit",reason="process exited with active calls")
        for text in ("-1","0","4294967296","12x"):
            case("invalid-limit-"+text,"caps",{"VIRGL_CAPTURE_MAX_EVENT_BYTES":text},"invalid recorder limit")
        case("event-count-limit","caps",{"VIRGL_CAPTURE_MAX_EVENTS":"2"},"recording limit exceeded")
        case("blob-limit","blob-limit",{"VIRGL_CAPTURE_MAX_BLOB_BYTES":"3"},"context name capture failed")
        case("event-byte-limit","caps",{"VIRGL_CAPTURE_MAX_EVENT_BYTES":"1"},"event byte limit exceeded")
        raw=case("footer-baseline","caps",{"VIRGL_CAPTURE_MAX_EVENT_BYTES":"10000"})
        prefix=sum(len(line) for line in raw.splitlines(keepends=True)[:-1])
        budget=prefix+1023
        for _ in range(3):budget=prefix+1023+len(str(budget))-5
        case("footer-insufficient","caps",{"VIRGL_CAPTURE_MAX_EVENT_BYTES":str(budget)},"insufficient event budget for footer")
        case("footer-exact","caps",{"VIRGL_CAPTURE_MAX_EVENT_BYTES":str(budget+1)})
        # A literal snapshot oracle must reject a wrong byte even when framing is unchanged.
        happy_events=[json.loads(x) for x in (output/"happy/events.jsonl").read_text().splitlines()]
        def sabotage(ref):
            data=(output/"happy/blobs"/(ref["sha256"]+".bin")).read_bytes()
            return b"X"+data[1:] if data==b"readAFT0" else data
        try:check_happy(happy_events,sabotage)
        except RuntimeError:report["oracleSabotageRejected"]=True
        else:raise RuntimeError("snapshot oracle accepted sabotaged readback")
        report["passed"]=True
    finally:
        write_json(output/"commands.json",commands)
        report["artifacts"]={str(p.relative_to(output)):digest(p) for p in sorted(output.rglob("*")) if p.is_file() and p.name!="report.json"}
        write_json(output/"report.json",report)
    print(json.dumps({"passed":True,"cases":len(report["cases"]),"oracleSabotageRejected":True,"output":str(output)}))


def host(args):
    root=Path(__file__).resolve().parents[3]
    output=args.output.resolve();output.mkdir(parents=True,exist_ok=False)
    inputs=output/"inputs";inputs.mkdir();(inputs/"abi").mkdir()
    for name in ("recorder_contract.c","recorder_harness.py"):
        shutil.copy2(Path(__file__).with_name(name),inputs/name)
    for name in ("recorder.c","recorder.build.sh"):
        shutil.copy2(root/"tools/virgl-capture"/name,inputs/name)
    vendor=root/"renderer/virgl-shader/vendor/src"
    for name in ("virglrenderer.h","virgl_hw.h"):
        shutil.copy2(vendor/name,inputs/"abi"/name)
    version=(vendor/"virgl-version.h.meson").read_text()
    for key,value in (("VIRGL_MAJOR_VERSION","1"),("VIRGL_MINOR_VERSION","3"),("VIRGL_MICRO_VERSION","0")):
        version=version.replace("@"+key+"@",value)
    require("@" not in version,"unhandled pinned version template")
    (inputs/"abi/virgl-version.h").write_text(version)
    write_json(inputs/"provenance.json",{"virglCommit":PIN,"version":"1.3.0","rootGitHead":subprocess.check_output(["git","rev-parse","HEAD"],cwd=root,text=True).strip(),
               "publicHeaders":"byte-identical pinned shader bridge vendor extraction; original license notices preserved",
               "versionHeader":"pinned Meson template with version1.3.0 substitutions","mockBoundary":"librecorder_fake.so substitutes renderer API only"})
    remote="/tmp/virgl-recorder-harness-"+uuid.uuid4().hex
    subprocess.run(["docker","exec",args.container,"mkdir",remote],check=True)
    subprocess.run(["docker","cp",str(inputs),args.container+":"+remote+"/inputs"],check=True)
    argv=["docker","exec",args.container,"python3",remote+"/inputs/recorder_harness.py","--inside","--inputs",remote+"/inputs","--output",remote+"/run"]
    result=subprocess.run(argv,capture_output=True,text=True)
    (output/"run.log").write_text(result.stdout+result.stderr)
    write_json(output/"invocation.json",{"argv":argv,"exitCode":result.returncode,"container":args.container})
    subprocess.run(["docker","cp",args.container+":"+remote+"/run",str(output/"run")],check=True)
    require(result.returncode==0,"native recorder harness failed; inspect "+str(output/"run.log"))
    require(digest(inputs/"recorder.c")==digest(root/"tools/virgl-capture/recorder.c"),"frozen recorder changed during run")
    print(result.stdout,end="")


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--container",default="wasm-vm-virgl-reference-research")
    parser.add_argument("--output",required=True,type=Path)
    parser.add_argument("--inside",action="store_true")
    parser.add_argument("--inputs",type=Path)
    args=parser.parse_args()
    inside(args) if args.inside else host(args)
