import assert from 'node:assert/strict';
import test from 'node:test';

process.env.GITHUB_USERNAME = 'natricknye';
const { mapRepo } = await import('../server/github.js');

function repo(overrides = {}) {
  return {
    id: 1,
    full_name: 'natricknye/demo',
    name: 'demo',
    owner: { login: 'natricknye' },
    description: 'demo',
    html_url: 'https://github.com/natricknye/demo',
    homepage: '',
    language: 'TypeScript',
    stargazers_count: 3,
    forks_count: 1,
    open_issues_count: 0,
    private: false,
    fork: false,
    archived: false,
    pushed_at: new Date().toISOString(),
    ...overrides,
  };
}

test('own public repo is ownership and visible', () => {
  const mapped = mapRepo(repo());
  assert.equal(mapped.relation, 'ownership');
  assert.equal(mapped.visible, true);
  assert.equal(mapped.status, 'active');
});

test('someone else repo is contribute', () => {
  const mapped = mapRepo(repo({ id: 2, full_name: 'other/demo', owner: { login: 'other' } }));
  assert.equal(mapped.relation, 'contribute');
  assert.equal(mapped.visible, true);
});

test('fork is contribute and visible unless private or archived', () => {
  const mapped = mapRepo(repo({ id: 3, fork: true }));
  assert.equal(mapped.relation, 'contribute');
  assert.equal(mapped.visible, true);
});

test('private and archived repos are hidden; old repos are paused', () => {
  const priv = mapRepo(repo({ id: 4, private: true }));
  assert.equal(priv.visible, false);
  const archived = mapRepo(repo({ id: 5, archived: true }));
  assert.equal(archived.visible, false);
  const old = mapRepo(repo({ id: 6, pushed_at: '2020-01-01T00:00:00.000Z' }));
  assert.equal(old.status, 'paused');
});
