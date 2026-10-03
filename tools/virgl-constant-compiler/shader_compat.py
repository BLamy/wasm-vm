"""Retain full E6 inputs/results and unchanged independent shader GPU oracles.

Exactly 105 historical negative bodies are promoted by the new native suite.
Their adjacent absolute-operand negatives replace them in historical workloads;
no historical full-gate receipt is produced for this successor interpretation.
"""
import copy
import json
from pathlib import Path

from compat_common import (ROOT, HELD_HEAD, E6_NATIVE, E6_SHA, require, sha, read,
                           binding, held, unchanged, source, load, git)

MIGRATIONS = 'renderer/virgl-shader/tests/constant-compiler-migrations.json'
PROMOTED = 'renderer/virgl-shader/tests/constant-compiler-cases.json'
MIGRATION_IDENTITIES_SHA = '3366293a8093c752f8ab3060a6f68a23e688f92489c243c53071d7e008443e6a'
IDENTITY_KEYS = ('fixture', 'fixtureIndex', 'oldName', 'stage', 'oldInputSha256',
                 'replacementName', 'replacementInputSha256', 'promotedCase')
SUITES = [
    ('raw', 'raw-bits', 'raw-bit', 'E6-T12e4a', 'rawCases', 'rawPairs'),
    ('integer', 'integer-masks', 'integer-mask', 'E6-T12e4b', 'integerCases', 'integerPairs'),
    ('float', 'float-masks', 'float-mask', 'E6-T12e4c1', 'floatCases', 'floatPairs'),
    ('numeric', 'numeric-floats', 'numeric-float', 'E6-T12e4c2', 'numericCases', 'numericPairs'),
    ('component', 'component-floats', 'component-float', 'E6-T12e5', 'componentCases', 'componentPairs'),
    ('dot', 'dot-reciprocals', 'dot-reciprocal', 'E6-T12e6', 'dotCases', 'dotPairs'),
]
FAULTS = {
    'raw-bits': ['sabotage'],
    'integer-masks': ['sabotage-' + x for x in ['signed-compare', 'all-ones-mask', 'ucmp-selection']],
    'float-masks': ['sabotage-' + x for x in ['unordered-guard', 'signed-zero', 'negative-order']],
    'numeric-floats': ['sabotage-' + x for x in ['stale-shadow', 'numeric-decode', 'sampler-index']],
    'component-floats': ['sabotage-' + x for x in ['lrp-order', 'frc-floor', 'div-operands', 'numeric-negate']],
    'dot-reciprocals': ['sabotage-' + x for x in ['dp3-lane', 'rcp-source', 'rsq-operation', 'numeric-negate']],
}


def retained(native):
    baseline = held(E6_NATIVE)
    require(sha((ROOT / E6_NATIVE).read_bytes()) == E6_SHA, 'exact verified E6 full native baseline')
    manifest = read(ROOT / MIGRATIONS)
    require(manifest['schema'] == 'wasm-vm-constant-compiler-migrations-v1'
            and manifest['parentHead'] == HELD_HEAD, 'explicit verified-parent migration schema')
    entries = manifest['migrations']
    identities = [{key: entry[key] for key in IDENTITY_KEYS} for entry in entries]
    require(len(entries) == 105 and sha(json.dumps(identities, sort_keys=True, separators=(',', ':')).encode())
            == MIGRATION_IDENTITIES_SHA, 'exact ordered 105 planned historical migrations')
    promotions = {entry['name']: entry for entry in read(ROOT / PROMOTED)}
    expected_groups, ledger, pair_ledger = {}, [], []
    for _, _, stem, _, case_key, pair_key in SUITES:
        old_case_key, old_pair_key = ('cases', 'pairs') if case_key == 'dotCases' else (case_key, pair_key)
        fixture_path = f'renderer/virgl-shader/tests/{stem}-cases.json'
        old_fixtures = json.loads(git('show', f'{HELD_HEAD}:{fixture_path}'))
        current_fixtures = read(ROOT / fixture_path)
        expected_fixtures = copy.deepcopy(old_fixtures)
        cases = copy.deepcopy(baseline[old_case_key])
        pairs = copy.deepcopy(baseline[old_pair_key])
        for migration in [entry for entry in entries if entry['fixture'] == fixture_path]:
            index = migration['fixtureIndex']
            original = old_fixtures[index]
            require(original['name'] == migration['oldName'] and original['text'] == migration['oldText']
                    and original['stage'] == migration['stage'] and original['ok'] is False
                    and sha(original['text'].encode('ascii')) == migration['oldInputSha256'],
                    'exact held historical negative input')
            replacement = copy.deepcopy(original)
            replacement.update(name=migration['replacementName'], text=migration['replacementText'])
            require(sha(replacement['text'].encode('ascii')) == migration['replacementInputSha256'],
                    'exact source-bound adjacent negative replacement')
            edit = migration['proposedEdit']
            lines = original['text'].splitlines(keepends=True)
            require(lines[edit['line'] - 1].rstrip('\n') == edit['before']
                    and edit['newOperand'] == ('-|' + edit['oldOperand'][1:] + '|' if edit['oldOperand'].startswith('-')
                                                else '|' + edit['oldOperand'] + '|'),
                    'only absolute numeric operand change, preserving outer typed minus')
            lines[edit['line'] - 1] = edit['after'] + '\n'
            require(''.join(lines) == replacement['text'], 'one exact adjacent line replacement')
            expected_fixtures[index] = replacement
            candidates = [entry for entry in cases if entry['name'] == original['name']]
            require(len(candidates) == 1, 'unique exact historical case')
            entry = candidates[0]
            require(entry['text'] == original['text'] and entry['result'] == migration['oldResult']
                    and entry['resultSha256'] == migration['oldResultSha256']
                    and entry['resultBytes'] == migration['oldResultBytes'], 'full held negative serialization')
            entry.update(name=replacement['name'], text=replacement['text'],
                         inputSha256=migration['replacementInputSha256'], bytes=len(replacement['text'].encode('ascii')))
            promoted = promotions[migration['promotedCase']]
            require(promoted['text'] == original['text'] and promoted['stage'] == original['stage']
                    and promoted['ok'] is True, 'original historical body promoted without rewrite')
            ledger.append({key: migration[key] for key in IDENTITY_KEYS})
        require(current_fixtures == expected_fixtures, 'no other historical case field/body/order changes')
        case_by_name = {entry['name']: entry for entry in cases}
        for entry in pairs:
            substitutions = []
            for stage in ('vertex', 'fragment'):
                key = stage + 'CaseName'
                migration = next((item for item in entries if item['fixture'] == fixture_path and item['oldName'] == entry[key]), None)
                if migration:
                    require(case_key == 'numericCases' and entry['name'] == f'rejected-{stage}-unsupported-feature-pair'
                            and migration['oldName'] == f'unknown-const-ADD-0-{stage}', 'only two exact numeric rejection pair substitutions')
                    substitutions.append({'stage': stage, 'oldCaseName': entry[key],
                        'newCaseName': migration['replacementName'], 'oldInputSha256': entry[stage + 'Sha256'],
                        'newInputSha256': migration['replacementInputSha256']})
                    entry[key] = migration['replacementName']
                    entry[stage + 'Sha256'] = migration['replacementInputSha256']
            if substitutions:
                pair_ledger.append({'group': pair_key, 'name': entry['name'], 'substitutions': substitutions,
                                    'retainedResult': entry['result'], 'retainedResultSha256': entry['resultSha256']})
            require(all(entry[stage + 'Sha256'] == case_by_name[entry[stage + 'CaseName']]['inputSha256']
                        for stage in ('vertex', 'fragment')), 'exact pair input references')
        require(native[case_key] == cases and native[pair_key] == pairs,
                'every retained native full result preserved with only explicit adjacent input migrations')
        expected_groups[case_key], expected_groups[pair_key] = cases, pairs
    require(sum(len(expected_groups[key]) for *_, key, _ in SUITES) == 2699
            and sum(len(expected_groups[key]) for *_, key in SUITES) == 203
            and native['originals'] == baseline['originals'], 'complete E6 original/case/pair result preservation')
    require(manifest['pairSubstitutions'] == pair_ledger and len(pair_ledger) == 2,
            'exact declared numeric rejection-pair input substitutions and unchanged full errors')
    return baseline, ledger


def held_faults(slug, cases, pairs, current):
    """Carry only fault claims with immutable evidence, oracle and full input output."""
    path = (f'evidence/virgl-{slug}/cold-clone/acceptance' if slug == 'dot-reciprocals'
            else f'evidence/virgl-{slug}/worker')
    receipt = held(path + '/receipt.json')
    require(receipt['status'] == 'passed', 'held full predecessor receipt was passing')
    sources = []
    for item in receipt['sources']:
        name = item['path']
        if (name.startswith(f'tools/virgl-{slug}/') and name.endswith('.py')) or name in {
                f'tools/verify-virgl-{slug}.mjs', 'tools/lib/virgl-browser-runner.mjs',
                f'renderer/virgl-shader/tests/{slug}.mjs'}:
            unchanged(name)
            require(sha((ROOT / name).read_bytes()) == item['sha256'], 'unchanged held fault harness and independent oracle')
            sources.append(binding(ROOT / name))
    require(sources, 'held fault dependency inventory')
    records = {record['path']: record for record in receipt['records']}
    controls = []
    for fault in FAULTS[slug]:
        report_path = path + '/' + fault + '/report.json'
        proof = held(report_path)
        require(proof['status'] == 'failed' and proof['acceptance']['status'] == 'failed', 'held actual source fault contradicted GPU oracle')
        require(all(proof['host'][key] == current['host'][key] for key in ('platform', 'architecture', 'release'))
                and proof['browser']['version'] == current['browser']['version']
                and proof['browser']['executableSha256'] == current['browser']['executableSha256']
                and proof['browser']['gpu']['devices'] == current['browser']['gpu']['devices']
                and proof['acceptance']['renderer'] == current['acceptance']['renderer'],
                'held fault host, exact browser executable and GPU dependency remain unchanged')
        require(sha((ROOT / report_path).read_bytes()) == records[fault + '/report.json']['sha256'], 'source-bound held fault digest')
        for entry in proof['acceptance']['anchors']:
            require(entry['result'] == cases[entry['name']]['result'], 'complete fault dependency compiler stage result unchanged')
        for entry in proof['acceptance']['pairs']:
            require(entry['result'] == pairs[entry['name']]['result'], 'complete fault dependency compiler pair result unchanged')
        for artifact_name in ('browserCoverage', 'failureScreenshot'):
            artifact = proof[artifact_name]
            relative = fault + '/' + artifact['path']
            raw = (ROOT / path / relative).read_bytes()
            require(sha(raw) == artifact['sha256'] == records[relative]['sha256'], 'held fault screenshot/coverage remains exact')
        controls.append({'prediction': fault, 'result': 'HELD', 'evidence': binding(ROOT / report_path),
                         'reason': 'Same fault harness and independent oracle; every complete compiler stage/pair result it consumed is identical.'})
    return {'receipt': binding(ROOT / path / 'receipt.json'), 'sources': sources, 'controls': controls}


def gpu(slug, proof, hardware, cases, pairs, gate):
    if slug in ('raw-bits', 'integer-masks', 'float-masks'):
        if slug != 'raw-bits':
            gate.verify_finite(proof, hardware, cases)
        return {'interpolationPixels': gate.verify_gpu(proof, hardware, cases, pairs)}
    gate.verify_source_contracts(proof, hardware, cases)
    extra = load('e6b_' + slug + '_browser', f'tools/virgl-{slug}/browser_receipt.py')
    extra.verify_orientation(proof, cases, helpers=vars(gate))
    numeric, cross = gate.verify_numeric(proof, hardware, cases)
    pair_pixels = gate.verify_pairs(proof, hardware, pairs)
    if slug == 'numeric-floats':
        textures, texture_cross, texture_pixels = gate.verify_textures(proof, hardware, cases)
        require(proof['checkedWords'] == numeric + textures == 352 and cross + texture_cross == 48
                and proof['checkedTexturePixels'] == texture_pixels == 4096 and pair_pixels == 25792,
                'complete unchanged numeric oracle counts')
        return {'numericWords': numeric, 'textureWords': textures, 'crossDraws': cross + texture_cross,
                'texturePixels': texture_pixels, 'interpolationPixels': pair_pixels}
    if slug == 'component-floats':
        textures, texture_cross, texture_pixels = gate.verify_textures(proof, hardware, cases)
        quantitative = load('e6b_division', f'tools/virgl-{slug}/division_receipt.py')
        bounds = quantitative.verify_division(proof, hardware, cases, helpers=vars(gate))
        observations = quantitative.verify_observations(proof, hardware, cases, helpers=vars(gate))
        require(proof['exactWords'] == numeric + textures + bounds['exactWords'] == 406
                and proof['boundedDivisionWords'] == bounds['boundedWords'] == 42
                and proof['checkedWords'] == 448 and proof['observedSpecialWords'] == observations['words'] == 96
                and proof['checkedTexturePixels'] == texture_pixels == 4096
                and cross + texture_cross + bounds['crossDraws'] == 60 and pair_pixels == 29760,
                'complete unchanged component quantitative counts')
        return {'numericWords': numeric, 'textureWords': textures, 'division': bounds,
                'observations': observations, 'texturePixels': texture_pixels, 'interpolationPixels': pair_pixels}
    gate.verify_sequences(proof, hardware)
    textures = gate.verify_textures(proof, hardware, cases)
    quantitative = load('e6b_reciprocal', f'tools/virgl-{slug}/reciprocal_receipt.py')
    bounds = quantitative.verify_reciprocals(proof, hardware, cases, helpers=vars(gate))
    observations = quantitative.verify_observations(proof, hardware, cases, helpers=vars(gate))
    require(proof['exactWords'] == numeric + textures['exactWords'] + bounds['exactWords'] == 310
            and proof['boundedReciprocalWords'] == textures['boundedWords'] + bounds['boundedWords'] == 178
            and proof['checkedWords'] == 488 and proof['observedSpecialWords'] == observations['words'] == 72
            and proof['checkedTexturePixels'] == textures['pixels'] == 6144
            and cross + textures['crossDraws'] + bounds['crossDraws'] == 72 and pair_pixels == 33728,
            'complete unchanged scalar quantitative counts')
    return {'numericWords': numeric, 'textures': textures, 'reciprocals': bounds,
            'observations': observations, 'interpolationPixels': pair_pixels}


def verify(output, head, native, contract):
    output = Path(output).resolve()
    baseline, migrations = retained(native)
    base = load('e6b_constants_browser_envelope', 'tools/virgl-constants/receipt.py')
    originals = {entry['sha256']: entry for entry in native['originals']}
    reports, summaries, names = [], [], set()
    for label, slug, stem, task, case_key, pair_key in SUITES:
        directory = output / 'shader-regression' / label
        gate = load('e6b_' + label + '_gpu', f'tools/virgl-{slug}/receipt.py')
        fixture_path = f'renderer/virgl-shader/tests/{stem}-cases.json'
        hardware_path = f'renderer/virgl-shader/tests/{stem}-hardware.json'
        unchanged(hardware_path)
        for path in [f'tools/verify-virgl-{slug}.mjs', f'renderer/virgl-shader/tests/{slug}.mjs',
                     *[str(path.relative_to(ROOT)) for path in (ROOT / f'tools/virgl-{slug}').glob('*.py')]]:
            unchanged(path)
            names.add(path)
        report = base.verify_browser(directory, head, contract, task=task)
        reports.append(report)
        proof = report['acceptance']
        fixtures, hardware = read(ROOT / fixture_path), read(ROOT / hardware_path)
        cases, pairs = ({entry['name']: entry for entry in native[key]} for key in (case_key, pair_key))
        gate.translations(proof, fixtures, hardware, cases, pairs, originals)
        require([entry['name'] for entry in proof['cases']] == [entry['name'] for entry in fixtures]
                and [entry['name'] for entry in proof['anchors']] == [entry['name'] for entry in hardware['shaders']]
                and [entry['name'] for entry in proof['pairs']] == [entry['name'] for entry in hardware['pairs']]
                and [entry['sha256'] for entry in proof['corpus']] == list(originals), 'complete ordered retained Wasm inputs')
        require(proof['caseFixture'] == binding(ROOT / fixture_path)
                and proof['hardwareFixture'] == binding(ROOT / hardware_path), 'exact retained fixture identities')
        if label == 'raw':
            require('operationDefinitions' not in proof and 'operationDefinitions' not in hardware,
                    'raw predecessor schema has no operation definition table')
        else:
            require(proof['operationDefinitions'] == hardware['operationDefinitions'],
                    'exact retained operation definitions')
        counts = gpu(slug, proof, hardware, cases, pairs, gate)
        require(proof['status'] == 'passed' and proof['sabotage'] is None and proof['omissions'] == []
                and proof['objects']['live'] == 0 and proof['objects']['created'] == proof['objects']['deleted'],
                'complete clean hardware execution and all actual GL ownership released')
        fault = held_faults(slug, cases, pairs, report)
        names.update(item['path'] for item in fault['sources'])
        names.update([fault['receipt']['path'], *[entry['evidence']['path'] for entry in fault['controls']]])
        summaries.append({'suite': slug, 'report': binding(directory / 'report.json', output), **counts,
                          'heldFaults': {key: value for key, value in fault.items() if key != 'sources'}})
    names.update(item['path'] for report in reports for item in report['sources'])
    names.update([E6_NATIVE, MIGRATIONS, PROMOTED, 'tools/virgl-constant-compiler/shader_compat.py',
                  'tools/virgl-constant-compiler/compat_common.py'])
    sources = []
    for name in sorted(names):
        if '/build/' not in name:
            item = binding(ROOT / name)
            source(item, head)
            sources.append(item)
    return {'schema': 'wasm-vm-e6-shader-successor-compat-v1', 'status': 'passed',
            'recordedHead': head, 'heldHead': HELD_HEAD, 'predecessorFullGateClaimed': False,
            'boundary': 'Complete retained E6 native and Wasm results plus unchanged independent GPU oracles, with exact 105 adjacent negatives and two pair substitutions; historical nested full gates are not claimed.',
            'baseline': binding(ROOT / E6_NATIVE), 'cases': 2699, 'pairs': 203,
            'originals': 19, 'acceptedOriginals': 12, 'migrations': migrations,
            'migrationSource': binding(ROOT / MIGRATIONS), 'suites': summaries, 'sources': sources}
