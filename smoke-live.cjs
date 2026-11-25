const { chromium } = require('playwright-core');

const base = process.env.BASE_URL || 'http://127.0.0.1:3002';
const password = process.env.PM_TEST_PASSWORD;
if (!password) {
  console.error('PM_TEST_PASSWORD is required');
  process.exit(1);
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', error => errors.push(String(error)));

  const stamp = Date.now();
  const taskTitle = `smoke task ${stamp}`;
  const noteBody = `## smoke note ${stamp}\n\n- real database\n- cleanup after test`;
  let projectId = null;
  let taskId = null;
  let noteId = null;

  try {
    await page.goto(`${base}/#/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('.project-card', { timeout: 30000 });
    console.log('public', JSON.stringify(await page.evaluate(() => ({
      title: document.title,
      cards: document.querySelectorAll('.project-card').length,
      tabs: [...document.querySelectorAll('.relation-tab')].map(item => item.innerText),
      privateTags: document.querySelectorAll('.tag.private').length,
      hasPrivateRepo: document.body.innerText.includes('JIAO'),
      hasFork: document.body.innerText.includes('Dela') || document.body.innerText.includes('opencode'),
    }))));

    const unauthorized = await page.request.get(`${base}/api/admin/projects`);
    console.log('unauthorized', JSON.stringify({ status: unauthorized.status() }));

    await page.locator('.project-card').first().click();
    await page.waitForSelector('.project-head h1', { timeout: 30000 });
    console.log('public-project', JSON.stringify(await page.evaluate(() => ({
      h1: document.querySelector('.project-head h1')?.innerText,
      adminPanel: Boolean(document.querySelector('.admin-panel')),
      loginHint: Boolean(document.querySelector('.login-hint')),
      tabs: document.querySelectorAll('.tab').length,
    }))));

    await page.goto(`${base}/#/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('input[type=password]', password);
    await page.click('button[type=submit]');
    await page.waitForFunction(() => location.hash === '#/' || location.hash === '', { timeout: 30000 });
    await page.waitForSelector('.project-card', { timeout: 30000 });
    console.log('login', JSON.stringify(await page.evaluate(() => ({
      loggedIn: !document.querySelector('.login-card'),
      cards: document.querySelectorAll('.project-card').length,
      privateTags: document.querySelectorAll('.tag.private').length,
    }))));

    const adminProjects = await page.request.get(`${base}/api/admin/projects`);
    const projectsBody = await adminProjects.json();
    const project = (projectsBody.projects || []).find(item => item.full_name === 'natricknye/n-pm');
    if (!project) throw new Error('n-pm project not found in admin list');
    projectId = project.id;
    console.log('admin-projects', JSON.stringify({
      status: adminProjects.status(),
      count: (projectsBody.projects || []).length,
      project: project.full_name,
      relation: project.relation,
      privateHidden: (projectsBody.projects || []).some(item => item.full_name === 'natricknye/JIAO' && item.is_private),
    }));

    await page.goto(`${base}/#/p/${projectId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.admin-panel', { timeout: 30000 });
    console.log('admin-project', JSON.stringify(await page.evaluate(() => ({
      h1: document.querySelector('.project-head h1')?.innerText,
      tabs: [...document.querySelectorAll('.tab')].map(item => item.innerText),
      adminPanel: Boolean(document.querySelector('.admin-panel')),
    }))));

    await page.getByRole('button', { name: '任务' }).click();
    await page.fill('input[placeholder^="加一个任务"]', taskTitle);
    await page.getByRole('button', { name: '添加' }).click();
    await page.locator('.task-row', { hasText: taskTitle }).waitFor({ timeout: 15000 });
    const tasksBody = await (await page.request.get(`${base}/api/admin/projects/${projectId}/tasks`)).json();
    taskId = (tasksBody.tasks || []).find(item => item.title === taskTitle)?.id;
    console.log('tasks', JSON.stringify({
      rows: await page.locator('.task-row').count(),
      created: Boolean(taskId),
      text: await page.locator('.task-row', { hasText: taskTitle }).innerText(),
    }));

    await page.getByRole('button', { name: '笔记' }).click();
    await page.fill('textarea[placeholder^="写项目笔记"]', noteBody);
    await page.getByRole('button', { name: '保存笔记' }).click();
    await page.locator('.note', { hasText: `smoke note ${stamp}` }).waitFor({ timeout: 15000 });
    const notesBody = await (await page.request.get(`${base}/api/admin/projects/${projectId}/notes`)).json();
    noteId = (notesBody.notes || []).find(item => item.body_md.includes(`smoke note ${stamp}`))?.id;
    console.log('notes', JSON.stringify({
      notes: await page.locator('.note').count(),
      created: Boolean(noteId),
      md: await page.locator('.note .markdown h2').first().innerText(),
    }));

    await page.getByRole('button', { name: 'Commits' }).click();
    await page.locator('.commit-row').first().waitFor({ timeout: 15000 });
    const commitCount = await page.locator('.commit-row').count();
    await page.locator('.commit-row').first().click();
    await page.waitForSelector('.diff, .notice.error', { timeout: 30000 });
    const diff = (await page.locator('.diff').count()) ? await page.locator('.diff').innerText() : '';
    const diffError = (await page.locator('.notice.error').count())
      ? await page.locator('.notice.error').innerText()
      : '';
    console.log('commits', JSON.stringify({
      rows: commitCount,
      diffLength: diff.length,
      diffHead: diff.slice(0, 60),
      diffError: diffError.slice(0, 300),
      hasDiffHeader: diff.includes('diff --git') || diff.includes('@@'),
    }));
    if (!diff) throw new Error(`commit diff unavailable: ${diffError}`);

    const sync = await page.request.get(`${base}/api/admin/sync`);
    const syncBody = await sync.json();
    console.log('sync-status', JSON.stringify({
      status: sync.status(),
      run: syncBody.sync?.status,
      repos: syncBody.sync?.repos,
      commits: syncBody.sync?.commits,
    }));

    const logout = await page.request.post(`${base}/api/logout`, { data: {} });
    const afterLogout = await page.request.get(`${base}/api/admin/projects`);
    console.log('logout', JSON.stringify({ status: logout.status(), adminAfter: afterLogout.status() }));
  } finally {
    if (projectId) {
      if (taskId) await page.request.delete(`${base}/api/admin/tasks/${taskId}`).catch(() => {});
      if (noteId) await page.request.delete(`${base}/api/admin/notes/${noteId}`).catch(() => {});
    }
    console.log('errors', JSON.stringify(errors));
    await browser.close();
  }
})().catch(error => {
  console.error('SMOKE FAILED:', error.message);
  process.exitCode = 1;
});
