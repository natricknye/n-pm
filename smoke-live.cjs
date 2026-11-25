const { chromium } = require('playwright-core');

const base = process.env.BASE_URL || 'http://127.0.0.1:3002';
const password = process.env.PM_TEST_PASSWORD;
const proxy = process.env.SMOKE_PROXY ? { server: process.env.SMOKE_PROXY } : undefined;
if (!password) {
  console.error('PM_TEST_PASSWORD is required');
  process.exit(1);
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true, proxy });
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
  let tempProjectId = null;

  try {
    await page.goto(`${base}/#/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('.project-card', { timeout: 30000 });
    console.log('public', JSON.stringify(await page.evaluate(() => ({
      title: document.title,
      cards: document.querySelectorAll('.project-card').length,
      sections: [...document.querySelectorAll('.source-section h2')].map(item => item.innerText),
      tabs: [...document.querySelectorAll('.relation-tab')].map(item => item.innerText),
      privateTags: document.querySelectorAll('.tag.private').length,
      hasPrivateRepo: document.body.innerText.includes('JIAO'),
      hasFork: document.body.innerText.includes('Dela') || document.body.innerText.includes('opencode'),
      hasLocalProject: document.body.innerText.includes('math-paper'),
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
      contributeVisible: (projectsBody.projects || []).some(item => item.full_name === 'natricknye/Dela' && item.visible),
      localVisible: (projectsBody.projects || []).some(item => item.full_name === 'local/math-paper' && item.source === 'local'),
    }));

    const localProject = (projectsBody.projects || []).find(item => item.full_name === 'local/math-paper');
    if (localProject) {
      await page.goto(`${base}/#/p/${localProject.id}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.project-head h1', { timeout: 30000 });
      console.log('local-project', JSON.stringify(await page.evaluate(() => ({
        h1: document.querySelector('.project-head h1')?.innerText,
        tabs: [...document.querySelectorAll('.tab')].map(item => item.innerText),
        sourceTag: [...document.querySelectorAll('.tag')].map(item => item.innerText).find(item => item === '本地项目'),
        localPath: document.querySelector('.facts dd.path')?.innerText || '',
      }))));
    }

    const localName = `smoke-ui-${stamp}`;
    await page.goto(`${base}/#/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.project-card', { timeout: 30000 });
    await page.getByRole('button', { name: '添加本地项目' }).click();
    const form = page.locator('.local-form');
    await form.locator('input').nth(0).fill(localName);
    await form.locator('input').nth(1).fill(`E:/tmp/${localName}`);
    await form.locator('textarea').fill('temporary ui form project');
    await form.getByRole('button', { name: '保存本地项目' }).click();
    await page.locator('.project-card', { hasText: localName }).waitFor({ timeout: 15000 });
    const formProjects = await (await page.request.get(`${base}/api/admin/projects`)).json();
    const formProject = (formProjects.projects || []).find(item => item.name === localName);
    tempProjectId = formProject?.id;
    console.log('local-form', JSON.stringify({
      created: Boolean(tempProjectId),
      source: formProject?.source,
      localPath: formProject?.local_path,
      visible: formProject?.visible,
    }));
    if (!tempProjectId) throw new Error('local project form creation failed');
    const deleteLocal = await page.request.delete(`${base}/api/admin/projects/${tempProjectId}`);
    console.log('local-delete', JSON.stringify({ status: deleteLocal.status() }));
    if (deleteLocal.status() === 200) tempProjectId = null;

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

    if (taskId) {
      await page.request.delete(`${base}/api/admin/tasks/${taskId}`);
      taskId = null;
    }
    if (noteId) {
      await page.request.delete(`${base}/api/admin/notes/${noteId}`);
      noteId = null;
    }

    const logout = await page.request.post(`${base}/api/logout`, { data: {} });
    const afterLogout = await page.request.get(`${base}/api/admin/projects`);
    console.log('logout', JSON.stringify({ status: logout.status(), adminAfter: afterLogout.status() }));
  } finally {
    if (tempProjectId) await page.request.delete(`${base}/api/admin/projects/${tempProjectId}`).catch(() => {});
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
