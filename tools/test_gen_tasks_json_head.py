#!/usr/bin/env python3
"""A shipped task timeline follows HEAD, regardless of unrelated local Git refs."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]
GENERATOR = REPO / 'tools/gen-tasks-json.py'


class TaskActivityHeadTest(unittest.TestCase):
    def test_unmerged_refs_cannot_change_published_activity(self):
        target = REPO / 'target'
        target.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='task-head-fixture-', dir=target) as temporary:
            fixture = Path(temporary)
            (fixture / 'tools').mkdir()
            (fixture / 'web').mkdir()
            (fixture / 'tasks/epic-0-fixture').mkdir(parents=True)
            (fixture / 'tools/gen-tasks-json.py').write_bytes(GENERATOR.read_bytes())
            (fixture / 'web/.gitkeep').touch()
            task = fixture / 'tasks/epic-0-fixture/E0-T999.md'
            body = ('---\nid: E0-T999\nepic: 0\ntitle: Committed fixture\n'
                    'status: pending\n---\n## Verification log\n'
                    '### 2020-01-01\nCommitted fixture event.\n')
            task.write_text(body, encoding='utf-8')
            (fixture / 'tasks/QUEUE.md').write_text('**0 / 1 tasks verified**\n', encoding='utf-8')
            env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
            env.update(GIT_AUTHOR_NAME='Test Fixture', GIT_AUTHOR_EMAIL='fixture@example.invalid',
                       GIT_COMMITTER_NAME='Test Fixture', GIT_COMMITTER_EMAIL='fixture@example.invalid',
                       GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM='1', GIT_TERMINAL_PROMPT='0')

            def git(*args, date=None):
                command_env = dict(env)
                if date:
                    command_env.update(GIT_AUTHOR_DATE=date, GIT_COMMITTER_DATE=date)
                return subprocess.check_output(
                    ['git', '-c', 'core.hooksPath=' + os.devnull, '-c', 'commit.gpgsign=false', *args],
                    cwd=fixture, env=command_env, stderr=subprocess.PIPE, text=True).strip()

            def generate():
                subprocess.run([sys.executable, str(fixture / 'tools/gen-tasks-json.py')],
                               cwd=fixture, env=env, check=True, capture_output=True)
                return (fixture / 'web/tasks.json').read_bytes()

            git('init', '--initial-branch=published')
            git('add', 'tools/gen-tasks-json.py', 'tasks', 'web/.gitkeep')
            git('commit', '-m', 'E0-T999 committed event', date='2020-01-01T12:00:00+00:00')
            published = git('rev-parse', 'HEAD')
            original = generate()
            git('checkout', '-b', 'unmerged-side')
            task.write_text(body.replace('status: pending', 'status: verified')
                            + '\n### 2020-01-02\nUnmerged fixture event.\n', encoding='utf-8')
            git('add', str(task.relative_to(fixture)))
            git('commit', '-m', 'E0-T999 unmerged event', date='2020-01-02T12:00:00+00:00')
            unmerged = git('rev-parse', 'HEAD')
            git('update-ref', 'refs/remotes/origin/unmerged-only', unmerged)
            git('update-ref', 'refs/stash', unmerged)
            git('checkout', '--detach', published)
            self.assertEqual(generate(), original, 'non-HEAD refs changed published task activity')

            git('checkout', '--detach', unmerged)
            advanced = generate()
            self.assertNotEqual(advanced, original)
            item = json.loads(advanced)['tasks'][0]
            self.assertEqual(item['status'], 'verified')
            self.assertTrue(any('unmerged event' in label for event in item['activity']
                                for label in event['labels']))
            git('checkout', '--detach', published)
            self.assertEqual(generate(), original, 'returning to HEAD did not reproduce output')


if __name__ == '__main__':
    unittest.main()
